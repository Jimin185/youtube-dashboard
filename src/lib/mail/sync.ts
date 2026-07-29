import { ImapFlow } from "imapflow";
import { simpleParser, type ParsedMail, type AddressObject } from "mailparser";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, ensureSchema, schema } from "../db";
import { decrypt } from "../crypto";
import { normalizeSubject } from "../outbound";
import { Pop3Client } from "./pop3";
import type { MailAccount } from "../db/schema";

const { mailAccounts, outbounds, messages } = schema;

interface MailboxState {
  uidValidity?: number;
  lastUid?: number;
}
interface SyncState {
  sent?: MailboxState;
  inbox?: MailboxState;
  pop?: { seen: string[] }; // POP3 모드: 처리한 메일 고유 ID 목록
}

const FIRST_SYNC_DAYS = 90; // 최초 연동 시 최근 90일까지만 수집

/** 수신 서버가 POP3인지 (하이웍스 등 IMAP 미지원 서버) */
export function isPop3Account(account: MailAccount): boolean {
  return (
    account.imapPort === 995 || account.imapPort === 110 || /(^|\.)pop3?s?\./i.test(account.imapHost)
  );
}

function addrList(a: AddressObject | AddressObject[] | undefined): { name: string; address: string }[] {
  if (!a) return [];
  const objs = Array.isArray(a) ? a : [a];
  return objs.flatMap((o) =>
    o.value.map((v) => ({ name: v.name ?? "", address: (v.address ?? "").toLowerCase() }))
  );
}

function snippetOf(parsed: ParsedMail): string {
  const text = (parsed.text ?? "").replace(/\s+/g, " ").trim();
  return text.slice(0, 200);
}

async function openImap(account: MailAccount): Promise<ImapFlow> {
  const client = new ImapFlow({
    host: account.imapHost,
    port: account.imapPort,
    secure: true,
    auth: { user: account.username, pass: decrypt(account.passwordEnc) },
    logger: false,
  });
  await client.connect();
  return client;
}

async function findSentMailboxPath(client: ImapFlow): Promise<string | null> {
  const boxes = await client.list();
  const bySpecialUse = boxes.find((b) => b.specialUse === "\\Sent");
  if (bySpecialUse) return bySpecialUse.path;
  const candidates = ["Sent Messages", "Sent", "Sent Items", "보낸편지함", "보낸 편지함"];
  for (const name of candidates) {
    const hit = boxes.find(
      (b) => b.path === name || b.name === name || b.path.endsWith(`/${name}`)
    );
    if (hit) return hit.path;
  }
  return null;
}

// 서버 실행 제한(300초) 안에서 안전하게 끝내기 위한 시간 예산.
// 넘으면 진행 상황을 저장하고 중단 → 다음 동기화가 이어서 처리한다.
const SYNC_TIME_BUDGET_MS = 230_000;

interface ProcessResult {
  processed: number;
  partial: boolean;
  state: MailboxState;
}

/**
 * 메일함을 UID 오름차순으로 순회하며 처리한다.
 * - prefilter가 있으면 겉봉(envelope/헤더)만 먼저 확인해 관련 없는 메일은 본문을 받지 않고 건너뜀
 * - 시간 예산을 넘으면 거기까지의 lastUid를 담아 partial=true로 반환 (다음 동기화가 이어서 처리)
 */
async function processMailbox(
  client: ImapFlow,
  path: string,
  state: MailboxState,
  deadline: number,
  handler: (parsed: ParsedMail) => Promise<void>,
  prefilter: ((uid: number) => Promise<boolean>) | null
): Promise<ProcessResult> {
  const lock = await client.getMailboxLock(path);
  try {
    const mailbox = client.mailbox;
    if (!mailbox || typeof mailbox === "boolean")
      return { processed: 0, partial: false, state };
    const uidValidity = Number(mailbox.uidValidity ?? 0);
    const sinceUid = state.uidValidity === uidValidity ? (state.lastUid ?? 0) : 0;

    let searchUids: number[] = [];
    if (sinceUid === 0) {
      // 최초 동기화: 최근 N일
      const since = new Date(Date.now() - FIRST_SYNC_DAYS * 24 * 60 * 60 * 1000);
      const res = await client.search({ since }, { uid: true });
      searchUids = Array.isArray(res) ? res : [];
    } else {
      const res = await client.search({ uid: `${sinceUid + 1}:*` }, { uid: true });
      searchUids = (Array.isArray(res) ? res : []).filter((u) => u > sinceUid);
    }
    searchUids.sort((a, b) => a - b); // 이어하기가 가능하려면 반드시 오름차순

    let processed = 0;
    let lastUid = sinceUid;
    let partial = false;
    for (const uid of searchUids) {
      if (Date.now() > deadline) {
        partial = true;
        break;
      }
      let include = true;
      if (prefilter) include = await prefilter(uid);
      if (include) {
        const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
        if (msg && typeof msg !== "boolean" && msg.source) {
          const parsed = await simpleParser(msg.source);
          await handler(parsed);
          processed++;
        }
      }
      lastUid = uid;
    }
    return { processed, partial, state: { uidValidity, lastUid } };
  } finally {
    lock.release();
  }
}

/** 메시지 ID가 이미 DB에 있는지 */
async function isKnownMessageId(messageId: string | undefined | null): Promise<boolean> {
  if (!messageId) return false;
  const db = getDb();
  const dup = await db
    .select({ id: messages.id })
    .from(messages)
    .where(eq(messages.messageId, messageId))
    .limit(1);
  return dup.length > 0;
}

/** In-Reply-To/References 값 목록 추출 */
function refIdsOf(parsed: ParsedMail): string[] {
  return [
    ...(parsed.inReplyTo ? [parsed.inReplyTo] : []),
    ...(Array.isArray(parsed.references)
      ? parsed.references
      : parsed.references
        ? [parsed.references]
        : []),
  ].filter(Boolean);
}

// 대시보드에서 보낸 직후 Gmail 보낸편지함에 생기는 사본을 같은 발송으로 간주하는 시간 창
const DUP_SEND_WINDOW_MS = 10 * 60 * 1000;

/** 보낸 메일 1건을 아웃바운드 목록에 반영 */
async function ingestSentMail(account: MailAccount, parsed: ParsedMail): Promise<void> {
  const db = getDb();
  const now = new Date();
  const date = parsed.date ?? now;
  const messageId = parsed.messageId ?? "";
  const subject = parsed.subject ?? "";
  const normSubject = normalizeSubject(subject);
  const myDomain = account.email.split("@")[1]?.toLowerCase() ?? "";
  const recipients = [...addrList(parsed.to), ...addrList(parsed.cc)].filter(
    (r) => r.address && !r.address.endsWith(`@${myDomain}`) && r.address !== account.email.toLowerCase()
  );
  if (recipients.length === 0) return;

  // 이미 수집된 메일이면 스킵
  if (messageId) {
    const dup = await db
      .select({ id: messages.id })
      .from(messages)
      .where(eq(messages.messageId, messageId))
      .limit(1);
    if (dup.length > 0) return;
  }

  // 스레드 헤더로 기존 아웃바운드 찾기 (Gmail이 Message-ID를 바꿔치기해도
  // In-Reply-To/References 는 우리가 저장한 이전 메일 ID를 가리킨다)
  const refIds = refIdsOf(parsed);
  let refOutboundId: number | null = null;
  if (refIds.length > 0) {
    const hit = await db
      .select({ outboundId: messages.outboundId })
      .from(messages)
      .where(inArray(messages.messageId, refIds))
      .limit(1);
    if (hit.length > 0) refOutboundId = hit[0].outboundId;
  }

  const bodyText = parsed.text ?? "";
  const bodyHtml = typeof parsed.html === "string" ? parsed.html : "";
  const snippet = snippetOf(parsed);

  for (const rcpt of recipients) {
    // 1순위: 스레드 헤더 매칭, 2순위: 같은 수신자 + 같은(정규화된) 제목
    let existing =
      refOutboundId !== null
        ? await db.select().from(outbounds).where(eq(outbounds.id, refOutboundId)).limit(1)
        : [];
    if (existing.length === 0) {
      existing = await db
        .select()
        .from(outbounds)
        .where(
          and(
            eq(outbounds.accountId, account.id),
            eq(outbounds.contactEmail, rcpt.address),
            eq(outbounds.normalizedSubject, normSubject)
          )
        )
        .limit(1);
    }

    let outboundId: number;
    if (existing.length > 0) {
      const o = existing[0];
      outboundId = o.id;

      // 대시보드에서 방금 발송한 메일의 Gmail 사본이면 통째로 스킵 (중복/차수 이중 반영 방지)
      const isDashboardCopy =
        Math.abs(date.getTime() - new Date(o.lastSentAt).getTime()) < DUP_SEND_WINDOW_MS;
      if (isDashboardCopy) continue;

      const updates: Partial<typeof outbounds.$inferInsert> = { updatedAt: now };
      if (date > new Date(o.lastSentAt)) {
        updates.lastSentAt = date;
        // 대시보드 밖(웹메일)에서 직접 리마인드를 보낸 경우도 차수 반영
        if (o.status === "active" && o.stage < 3) updates.stage = o.stage + 1;
      }
      if (date < new Date(o.firstSentAt)) updates.firstSentAt = date;
      await db.update(outbounds).set(updates).where(eq(outbounds.id, o.id));
    } else {
      const inserted = await db
        .insert(outbounds)
        .values({
          accountId: account.id,
          userId: account.userId,
          clientName: rcpt.address.split("@")[1]?.split(".")[0] ?? "",
          contactName: rcpt.name,
          contactEmail: rcpt.address,
          subject,
          normalizedSubject: normSubject,
          firstSentAt: date,
          lastSentAt: date,
          stage: 1,
          status: "active",
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: outbounds.id });
      outboundId = inserted[0].id;
    }

    await db.insert(messages).values({
      outboundId,
      direction: "sent",
      messageId,
      inReplyTo: parsed.inReplyTo ?? "",
      subject,
      fromAddr: account.email.toLowerCase(),
      toAddr: rcpt.address,
      date,
      snippet,
      bodyText,
      bodyHtml,
      createdAt: now,
    });
  }
}

/** 받은 메일 1건을 답변으로 매칭 */
async function ingestReceivedMail(account: MailAccount, parsed: ParsedMail): Promise<void> {
  const db = getDb();
  const now = new Date();
  const date = parsed.date ?? now;
  const messageId = parsed.messageId ?? "";
  const from = addrList(parsed.from)[0];
  if (!from?.address) return;

  const myDomain = account.email.split("@")[1]?.toLowerCase() ?? "";
  if (from.address.endsWith(`@${myDomain}`)) return; // 내부 메일 무시

  if (messageId) {
    const dup = await db
      .select({ id: messages.id })
      .from(messages)
      .where(eq(messages.messageId, messageId))
      .limit(1);
    if (dup.length > 0) return;
  }

  // 1순위: In-Reply-To / References 로 우리가 보낸 메일과 매칭
  const refIds = refIdsOf(parsed);

  let outboundId: number | null = null;
  if (refIds.length > 0) {
    const hit = await db
      .select({ outboundId: messages.outboundId })
      .from(messages)
      .where(and(inArray(messages.messageId, refIds), eq(messages.direction, "sent")))
      .limit(1);
    if (hit.length > 0) outboundId = hit[0].outboundId;
  }

  // 2순위: 보낸 상대 주소로 매칭
  if (outboundId === null) {
    const normSubject = normalizeSubject(parsed.subject ?? "");
    const candidates = await db
      .select()
      .from(outbounds)
      .where(and(eq(outbounds.accountId, account.id), eq(outbounds.contactEmail, from.address)));
    if (candidates.length === 0) return; // 아웃바운드와 무관한 메일
    const bySubject = candidates.find((c) => c.normalizedSubject === normSubject);
    outboundId = (bySubject ?? candidates[0]).id;
  }

  await db.insert(messages).values({
    outboundId,
    direction: "received",
    messageId,
    inReplyTo: parsed.inReplyTo ?? "",
    subject: parsed.subject ?? "",
    fromAddr: from.address,
    toAddr: account.email.toLowerCase(),
    date,
    snippet: snippetOf(parsed),
    bodyText: parsed.text ?? "",
    bodyHtml: typeof parsed.html === "string" ? parsed.html : "",
    createdAt: now,
  });

  // 답변수신 처리 (담당자가 이름을 알려준 적 없으면 발신자 이름으로 채움)
  const target = await db.select().from(outbounds).where(eq(outbounds.id, outboundId)).limit(1);
  if (target.length > 0 && target[0].status === "active") {
    await db
      .update(outbounds)
      .set({
        status: "replied",
        repliedAt: date,
        contactName: target[0].contactName || from.name,
        updatedAt: now,
      })
      .where(eq(outbounds.id, outboundId));
  }
}

export interface SyncResult {
  accountId: number;
  sentFetched: number;
  receivedFetched: number;
  partial?: boolean; // 시간 예산 초과로 중단됨 — 다시 동기화하면 이어서 처리
  error?: string;
}

/** 헤더만 파싱해서 답변 후보인지 판단 (POP3 프리필터) */
async function isReplyCandidate(
  account: MailAccount,
  headerParsed: ParsedMail
): Promise<boolean> {
  const db = getDb();
  const myDomain = account.email.split("@")[1]?.toLowerCase() ?? "";
  const from = addrList(headerParsed.from)[0]?.address ?? "";
  if (!from || from === account.email.toLowerCase() || from.endsWith(`@${myDomain}`)) return false;
  if (await isKnownMessageId(headerParsed.messageId)) return false;
  // 최초 동기화 범위 밖의 오래된 메일은 제외
  if (headerParsed.date && Date.now() - headerParsed.date.getTime() > FIRST_SYNC_DAYS * 86400_000)
    return false;
  const refIds = refIdsOf(headerParsed);
  if (refIds.length > 0) {
    const hit = await db
      .select({ id: messages.id })
      .from(messages)
      .where(inArray(messages.messageId, refIds))
      .limit(1);
    if (hit.length > 0) return true;
  }
  const o = await db
    .select({ id: outbounds.id })
    .from(outbounds)
    .where(and(eq(outbounds.accountId, account.id), eq(outbounds.contactEmail, from)))
    .limit(1);
  return o.length > 0;
}

/**
 * POP3 동기화 (하이웍스 등): 받은편지함만 읽어 답장을 감지한다.
 * 보낸편지함은 POP3로 접근 불가 → 발송 기록은 대시보드 발송/엑셀 업로드로 관리.
 */
async function syncAccountPop3(
  account: MailAccount,
  result: SyncResult,
  deadline: number
): Promise<void> {
  const db = getDb();
  const state: SyncState = JSON.parse(account.syncState || "{}");
  const seen = new Set(state.pop?.seen ?? []);

  const client = new Pop3Client();
  try {
    await client.connect(account.imapHost, account.imapPort);
    await client.login(account.username, decrypt(account.passwordEnc));
    const list = await client.uidl();
    const fresh = list.filter((m) => !seen.has(m.uid));

    for (const m of fresh) {
      if (Date.now() > deadline) {
        result.partial = true;
        break;
      }
      // 헤더만 먼저 받아 관련 메일인지 확인
      const headerRaw = await client.top(m.num);
      const headerParsed = await simpleParser(headerRaw);
      if (await isReplyCandidate(account, headerParsed)) {
        const raw = await client.retr(m.num);
        const parsed = await simpleParser(raw);
        await ingestReceivedMail(account, parsed);
        result.receivedFetched++;
      }
      seen.add(m.uid);
    }

    state.pop = { seen: [...seen] };
    await db
      .update(mailAccounts)
      .set({ syncState: JSON.stringify(state), lastSyncAt: new Date(), lastSyncError: null })
      .where(eq(mailAccounts.id, account.id));
  } finally {
    await client.quit();
  }
}

/** 계정 1개 동기화: 보낸편지함 → 아웃바운드 수집, 받은편지함 → 답변 매칭 */
export async function syncAccount(account: MailAccount): Promise<SyncResult> {
  await ensureSchema();
  const db = getDb();
  const result: SyncResult = { accountId: account.id, sentFetched: 0, receivedFetched: 0 };
  const deadline = Date.now() + SYNC_TIME_BUDGET_MS;

  // POP3 서버(하이웍스 등)는 별도 경로로
  if (isPop3Account(account)) {
    try {
      await syncAccountPop3(account, result, deadline);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[sync-pop3] account=${account.email} error=${msg}`);
      result.error = msg;
      await db
        .update(mailAccounts)
        .set({ lastSyncError: msg, lastSyncAt: new Date() })
        .where(eq(mailAccounts.id, account.id));
    }
    return result;
  }

  let client: ImapFlow | null = null;
  try {
    client = await openImap(account);
    const imap = client;
    const state: SyncState = JSON.parse(account.syncState || "{}");
    const myDomain = account.email.split("@")[1]?.toLowerCase() ?? "";

    // ── 보낸편지함: 이미 수집한 메일은 겉봉만 보고 건너뜀 ──
    const sentPath = await findSentMailboxPath(imap);
    if (sentPath) {
      const r = await processMailbox(
        imap,
        sentPath,
        state.sent ?? {},
        deadline,
        (parsed) => ingestSentMail(account, parsed),
        async (uid) => {
          const meta = await imap.fetchOne(String(uid), { envelope: true }, { uid: true });
          if (!meta || typeof meta === "boolean") return false;
          return !(await isKnownMessageId(meta.envelope?.messageId));
        }
      );
      result.sentFetched = r.processed;
      result.partial ||= r.partial;
      state.sent = r.state;
    }

    // ── 받은편지함: 겉봉만 보고 아웃바운드와 관련 있는 메일만 본문을 받는다 (대용량 메일함 대응) ──
    {
      const r = await processMailbox(
        imap,
        "INBOX",
        state.inbox ?? {},
        deadline,
        (parsed) => ingestReceivedMail(account, parsed),
        async (uid) => {
          const meta = await imap.fetchOne(
            String(uid),
            { envelope: true, headers: ["in-reply-to", "references"] },
            { uid: true }
          );
          if (!meta || typeof meta === "boolean") return false;
          const from = meta.envelope?.from?.[0]?.address?.toLowerCase() ?? "";
          if (!from || from === account.email.toLowerCase() || from.endsWith(`@${myDomain}`)) return false;
          if (await isKnownMessageId(meta.envelope?.messageId)) return false;
          // 우리가 보낸 메일에 대한 답장인지 (스레드 헤더)
          const refIds = (meta.headers?.toString() ?? "").match(/<[^<>\s]+@[^<>\s]+>/g) ?? [];
          if (refIds.length > 0) {
            const hit = await db
              .select({ id: messages.id })
              .from(messages)
              .where(inArray(messages.messageId, refIds))
              .limit(1);
            if (hit.length > 0) return true;
          }
          // 아웃바운드 상대에게서 온 메일인지
          const o = await db
            .select({ id: outbounds.id })
            .from(outbounds)
            .where(and(eq(outbounds.accountId, account.id), eq(outbounds.contactEmail, from)))
            .limit(1);
          return o.length > 0;
        }
      );
      result.receivedFetched = r.processed;
      result.partial ||= r.partial;
      state.inbox = r.state;
    }

    await db
      .update(mailAccounts)
      .set({ syncState: JSON.stringify(state), lastSyncAt: new Date(), lastSyncError: null })
      .where(eq(mailAccounts.id, account.id));
    if (result.partial) {
      console.log(`[sync] account=${account.email} partial — 이어하기 필요 (sent=${result.sentFetched}, inbox=${result.receivedFetched})`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[sync] account=${account.email} error=${msg}`);
    result.error = msg;
    await db
      .update(mailAccounts)
      .set({ lastSyncError: msg, lastSyncAt: new Date() })
      .where(eq(mailAccounts.id, account.id));
  } finally {
    if (client) {
      try {
        await client.logout();
      } catch {
        /* ignore */
      }
    }
  }
  return result;
}

/** 수신 서버 접속 테스트 (설정 화면의 '연결 테스트' 버튼용) — IMAP/POP3 자동 구분 */
export async function testImapConnection(account: MailAccount): Promise<void> {
  if (isPop3Account(account)) {
    const client = new Pop3Client();
    try {
      await client.connect(account.imapHost, account.imapPort);
      await client.login(account.username, decrypt(account.passwordEnc));
    } finally {
      await client.quit();
    }
    return;
  }
  const client = await openImap(account);
  try {
    await client.list();
  } finally {
    try {
      await client.logout();
    } catch {
      /* ignore */
    }
  }
}
