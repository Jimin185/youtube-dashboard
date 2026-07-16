import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";
import { ImapFlow } from "imapflow";
import crypto from "crypto";
import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "../db";
import { decrypt } from "../crypto";
import { renderTemplate } from "../outbound";
import type { MailAccount, Outbound } from "../db/schema";

const { outbounds, messages } = schema;

export interface SendItemResult {
  outboundId: number;
  ok: boolean;
  error?: string;
}

function textToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<div style="font-family:'Apple SD Gothic Neo','Malgun Gothic',sans-serif;font-size:14px;line-height:1.7;white-space:pre-wrap;">${escaped}</div>`;
}

function buildRaw(options: ConstructorParameters<typeof MailComposer>[0]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    new MailComposer(options).compile().build((err, message) => {
      if (err) reject(err);
      else resolve(message);
    });
  });
}

/** 발송한 메일을 메일함의 보낸편지함에도 저장 (실패해도 발송 자체는 성공 처리) */
async function appendToSentFolder(account: MailAccount, raws: Buffer[]): Promise<void> {
  if (raws.length === 0) return;
  // Gmail은 SMTP로 보낸 메일을 자동으로 보낸편지함에 저장하므로 중복 저장하지 않음
  if (account.smtpHost.toLowerCase().includes("gmail")) return;
  const client = new ImapFlow({
    host: account.imapHost,
    port: account.imapPort,
    secure: true,
    auth: { user: account.username, pass: decrypt(account.passwordEnc) },
    logger: false,
  });
  await client.connect();
  try {
    const boxes = await client.list();
    const sent =
      boxes.find((b) => b.specialUse === "\\Sent") ??
      boxes.find((b) => ["Sent Messages", "Sent", "Sent Items", "보낸편지함"].includes(b.name));
    if (!sent) return;
    for (const raw of raws) {
      await client.append(sent.path, raw, ["\\Seen"]);
    }
  } finally {
    try {
      await client.logout();
    } catch {
      /* ignore */
    }
  }
}

/**
 * 선택한 아웃바운드들에 메일 발송 (단건/일괄 공용).
 * - 기존 스레드에 이어지도록 In-Reply-To/References 헤더를 붙인다.
 * - subject 를 비우면 기존 제목에 Re: 를 붙여 보낸다.
 * - 발송 성공 시 차수(stage)를 올린다 (답변수신 상태면 차수 유지).
 * - {{담당자}}, {{클라이언트}} 변수가 수신자별로 치환된다.
 */
export async function sendToOutbounds(
  account: MailAccount,
  targets: Outbound[],
  subjectTemplate: string,
  bodyTemplate: string
): Promise<SendItemResult[]> {
  const db = getDb();
  let transporter: ReturnType<typeof nodemailer.createTransport>;
  try {
    transporter = nodemailer.createTransport({
      host: account.smtpHost,
      port: account.smtpPort,
      secure: account.smtpPort === 465,
      auth: { user: account.username, pass: decrypt(account.passwordEnc) },
    });
  } catch (err) {
    // 계정 정보 문제(복호화 실패 등) → 전건 실패 처리
    const msg = err instanceof Error ? err.message : String(err);
    return targets.map((o) => ({ outboundId: o.id, ok: false, error: `메일 계정 오류: ${msg}` }));
  }

  const domain = account.email.split("@")[1] ?? "mail";
  const results: SendItemResult[] = [];
  const sentRaws: Buffer[] = [];

  for (const o of targets) {
    try {
      // 스레드 유지를 위해 마지막 메시지 ID 조회
      const last = await db
        .select()
        .from(messages)
        .where(eq(messages.outboundId, o.id))
        .orderBy(desc(messages.date))
        .limit(1);
      const lastMsg = last[0];

      const subject = subjectTemplate.trim()
        ? renderTemplate(subjectTemplate, o)
        : o.subject
          ? o.subject.toLowerCase().startsWith("re:")
            ? o.subject
            : `Re: ${o.subject}`
          : "(제목 없음)";
      const body = renderTemplate(bodyTemplate, o);
      const messageId = `<${crypto.randomUUID()}@${domain}>`;

      const mailOptions = {
        from: account.email,
        to: o.contactEmail,
        subject,
        text: body,
        html: textToHtml(body),
        messageId,
        inReplyTo: lastMsg?.messageId || undefined,
        references: lastMsg?.messageId ? [lastMsg.messageId] : undefined,
      };
      const raw = await buildRaw(mailOptions);
      await transporter.sendMail({
        envelope: { from: account.email, to: [o.contactEmail] },
        raw,
      });
      sentRaws.push(raw);

      const now = new Date();
      await db.insert(messages).values({
        outboundId: o.id,
        direction: "sent",
        messageId,
        inReplyTo: lastMsg?.messageId ?? "",
        subject,
        fromAddr: account.email.toLowerCase(),
        toAddr: o.contactEmail,
        date: now,
        snippet: body.replace(/\s+/g, " ").slice(0, 200),
        bodyText: body,
        bodyHtml: textToHtml(body),
        createdAt: now,
      });
      await db
        .update(outbounds)
        .set({
          lastSentAt: now,
          stage: o.status === "active" && o.stage < 3 ? o.stage + 1 : o.stage,
          updatedAt: now,
        })
        .where(eq(outbounds.id, o.id));

      results.push({ outboundId: o.id, ok: true });
    } catch (err) {
      results.push({
        outboundId: o.id,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  transporter.close();

  // 보낸편지함 저장은 부가 기능: 실패해도 무시
  try {
    await appendToSentFolder(account, sentRaws);
  } catch {
    /* ignore */
  }
  return results;
}
