import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, ensureSchema, schema } from "@/lib/db";
import { getUserId } from "@/lib/session";
import { normalizeSubject } from "@/lib/outbound";

const { outbounds, mailAccounts } = schema;

const rowSchema = z.object({
  clientName: z.string().default(""),
  contactName: z.string().default(""),
  contactEmail: z.string().default(""),
  officialEmail: z.string().default(""),
  website: z.string().default(""),
  memo: z.string().default(""),
  importance: z.coerce.number().int().min(0).max(3).default(0),
  subject: z.string().default(""),
  status: z.enum(["active", "replied", "closed"]).default("active"),
  stage: z.coerce.number().int().min(1).max(3).default(1),
  sentAt: z.string().default(""), // ISO 날짜 문자열 (비우면 오늘)
});

const bodySchema = z.object({ rows: z.array(rowSchema).min(1) });

const isEmail = (s: string) => /^\S+@\S+\.\S+$/.test(s);

/**
 * 대시보드 도입 전에 이미 발송했던 건들을 엑셀로 일괄 등록.
 * 보낼 목록이 아니라 '보낸 목록(아웃바운드)'에 상태/차수/발송일 그대로 들어간다.
 */
export async function POST(req: Request) {
  await ensureSchema();
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "입력값이 올바르지 않습니다." },
      { status: 400 }
    );
  }

  const db = getDb();
  const myAccounts = await db.select().from(mailAccounts).where(eq(mailAccounts.userId, userId));
  if (myAccounts.length === 0) {
    return NextResponse.json(
      { error: "기존 발송분을 등록하려면 먼저 설정에서 메일 계정을 연결해 주세요." },
      { status: 400 }
    );
  }
  const accountId = myAccounts[0].id;

  // 이메일 정리 (담당자 없으면 공식이메일로)
  let invalid = 0;
  const seen = new Set<string>();
  const rows = parsed.data.rows
    .map((r) => {
      const contact = r.contactEmail.trim().toLowerCase();
      const official = r.officialEmail.trim().toLowerCase();
      const sendTo = isEmail(contact) ? contact : isEmail(official) ? official : "";
      return { ...r, contactEmail: sendTo, officialEmail: isEmail(official) ? official : "" };
    })
    .filter((r) => {
      if (!r.contactEmail) {
        invalid++;
        return false;
      }
      if (seen.has(r.contactEmail)) return false;
      seen.add(r.contactEmail);
      return true;
    });

  if (rows.length === 0) {
    return NextResponse.json({ inserted: 0, skipped: 0, invalid });
  }

  // 이미 같은 이메일의 아웃바운드가 있으면 스킵 (중복 방지)
  const emails = rows.map((r) => r.contactEmail);
  const existing = await db
    .select({ contactEmail: outbounds.contactEmail })
    .from(outbounds)
    .where(and(eq(outbounds.userId, userId), inArray(outbounds.contactEmail, emails)));
  const existingSet = new Set(existing.map((e) => e.contactEmail));
  const toInsert = rows.filter((r) => !existingSet.has(r.contactEmail));

  const now = new Date();
  if (toInsert.length > 0) {
    await db.insert(outbounds).values(
      toInsert.map((r) => {
        const sentDate = r.sentAt && !isNaN(new Date(r.sentAt).getTime()) ? new Date(r.sentAt) : now;
        return {
          accountId,
          userId,
          clientName: r.clientName.trim(),
          contactName: r.contactName.trim(),
          contactEmail: r.contactEmail,
          subject: r.subject.trim(),
          normalizedSubject: normalizeSubject(r.subject),
          firstSentAt: sentDate,
          lastSentAt: sentDate,
          stage: r.stage,
          status: r.status,
          repliedAt: r.status === "replied" ? sentDate : null,
          importance: r.importance,
          officialEmail: r.officialEmail,
          website: r.website.trim(),
          memo: r.memo.trim(),
          createdAt: now,
          updatedAt: now,
        };
      })
    );
  }

  return NextResponse.json({
    inserted: toInsert.length,
    skipped: rows.length - toInsert.length,
    invalid,
  });
}
