import { ImapFlow } from "imapflow";
import { simpleParser, type ParsedMail, type AddressObject } from "mailparser";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, ensureSchema, schema } from "../db";
import { decrypt } from "../crypto";
import { normalizeSubject } from "../outbound";
import type { MailAccount } from "../db/schema";

const { mailAccounts, outbounds, messages } = schema;

interface MailboxState {
  uidValidity?: number;
  lastUid?: number;
}
interface SyncState {
  sent?: MailboxState;
  inbox?: MailboxState;
}

const FIRST_SYNC_DAYS = 90; // 최초 연동 시 최근 90일까지만 수집

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

interface FetchedMail {
  uid: number;
  parsed: ParsedMail;
}

/** 특정 메일함에서 lastUid 이후의 새 메일을 파싱해 가져온다 */
async function fetchNewMails(
  client: ImapFlow,
  path: string,
  state: MailboxState
): Promise<{ mails: FetchedMail[]; newState: MailboxState }> {
  const lock = await client.getMailboxLock(path);
  try {
    const mailbox = client.mailbox;
    if (!mailbox || typeof mailbox === "boolean") return { mails: [], newState: state };
    const uidValidity = Number(mailbox.uidValidity ?? 0);
    let sinceUid = state.uidValidity === uidValidity ? state.lastUid ?? 0 : 0;

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

    const mails: FetchedMail[] = [];
    let maxUid = sinceUid;
    for (const uid of searchUids) {
      const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
      if (!msg || typeof msg === "boolean" || !msg.source) continue;
      const parsed = await simpleParser(msg.source);
      mails.push({ uid, parsed });
      if (uid > maxUid) maxUid = uid;
    }
    return { mails, newState: { uidValidity, lastUid: maxUid } };
  } finally {
    lock.release();
  }
}

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

  const bodyText = parsed.text ?? "";
  const bodyHtml = typeof parsed.html === "string" ? parsed.html : "";
  const snippet = snippetOf(parsed);

  for (const rcpt of recipients) {
    // 같은 계정 + 같은 수신자 + 같은(정규화된) 제목이면 같은 아웃바운드 스레드로 취급
    const existing = await db
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

    let outboundId: number;
    if (existing.length > 0) {
      const o = existing[0];
      outboundId = o.id;
      const updates: Partial<typeof outbounds.$inferInsert> = { updatedAt: now };
      if (date > new Date(o.lastSentAt)) {
        updates.lastSentAt = date;
        // 대시보드 밖(하이웍스 웹메일)에서 직접 리마인드를 보낸 경우도 차수 반영
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
  const refIds = [
    ...(parsed.inReplyTo ? [parsed.inReplyTo] : []),
    ...(Array.isArray(parsed.references)
      ? parsed.references
      : parsed.references
        ? [parsed.references]
        : []),
  ].filter(Boolean);

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
  error?: string;
}

/** 계정 1개 동기화: 보낸편지함 → 아웃바운드 수집, 받은편지함 → 답변 매칭 */
export async function syncAccount(account: MailAccount): Promise<SyncResult> {
  await ensureSchema();
  const db = getDb();
  const result: SyncResult = { accountId: account.id, sentFetched: 0, receivedFetched: 0 };

  let client: ImapFlow | null = null;
  try {
    client = await openImap(account);
    const state: SyncState = JSON.parse(account.syncState || "{}");

    const sentPath = await findSentMailboxPath(client);
    if (sentPath) {
      const { mails, newState } = await fetchNewMails(client, sentPath, state.sent ?? {});
      // 오래된 것부터 처리해야 차수 계산이 맞다
      mails.sort((a, b) => (a.parsed.date?.getTime() ?? 0) - (b.parsed.date?.getTime() ?? 0));
      for (const m of mails) {
        await ingestSentMail(account, m.parsed);
      }
      result.sentFetched = mails.length;
      state.sent = newState;
    }

    {
      const { mails, newState } = await fetchNewMails(client, "INBOX", state.inbox ?? {});
      mails.sort((a, b) => (a.parsed.date?.getTime() ?? 0) - (b.parsed.date?.getTime() ?? 0));
      for (const m of mails) {
        await ingestReceivedMail(account, m.parsed);
      }
      result.receivedFetched = mails.length;
      state.inbox = newState;
    }

    await db
      .update(mailAccounts)
      .set({ syncState: JSON.stringify(state), lastSyncAt: new Date(), lastSyncError: null })
      .where(eq(mailAccounts.id, account.id));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
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

/** IMAP 접속 테스트 (설정 화면의 '연결 테스트' 버튼용) */
export async function testImapConnection(account: MailAccount): Promise<void> {
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
