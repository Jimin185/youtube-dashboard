import { NextResponse } from "next/server";
import { z } from "zod";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, ensureSchema, schema } from "@/lib/db";
import { getUserId } from "@/lib/session";

const { prospects } = schema;

/** 내 보낼 목록 (대기 중) */
export async function GET() {
  await ensureSchema();
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const db = getDb();
  const rows = await db
    .select()
    .from(prospects)
    .where(and(eq(prospects.userId, userId), eq(prospects.status, "pending")))
    .orderBy(desc(prospects.createdAt));
  return NextResponse.json({ items: rows });
}

const rowSchema = z.object({
  clientName: z.string().default(""),
  contactName: z.string().default(""),
  contactEmail: z.string().default(""),
  officialEmail: z.string().default(""),
  website: z.string().default(""),
  memo: z.string().default(""),
  importance: z.coerce.number().int().min(0).max(3).default(0),
});

const bodySchema = z.object({ rows: z.array(rowSchema).min(1) });

const isEmail = (s: string) => /^\S+@\S+\.\S+$/.test(s);

/**
 * 보낼 목록 추가 (단건/일괄 공용).
 * - 필수: 담당자 이메일 또는 공식이메일 중 하나 (담당자 이메일이 없으면 공식이메일로 발송)
 * - 이미 등록된 이메일은 건너뛴다
 */
export async function POST(req: Request) {
  await ensureSchema();
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const raw = await req.json();
  // 단건 형태도 허용
  const parsed = bodySchema.safeParse(Array.isArray(raw?.rows) ? raw : { rows: [raw] });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "입력값이 올바르지 않습니다." },
      { status: 400 }
    );
  }

  // 담당자 이메일이 없으면 공식이메일을 발송 주소로 사용
  let invalid = 0;
  const normalized = parsed.data.rows.map((r) => {
    const contact = r.contactEmail.trim().toLowerCase();
    const official = r.officialEmail.trim().toLowerCase();
    const sendTo = isEmail(contact) ? contact : isEmail(official) ? official : "";
    return {
      ...r,
      contactEmail: sendTo,
      officialEmail: isEmail(official) ? official : "",
    };
  });

  // 이메일이 하나도 없는 행 제외 + 요청 안 중복 제거
  const seen = new Set<string>();
  const rows = normalized.filter((r) => {
    if (!r.contactEmail) {
      invalid++;
      return false;
    }
    if (seen.has(r.contactEmail)) return false;
    seen.add(r.contactEmail);
    return true;
  });
  const requestDup = normalized.length - invalid - rows.length;

  if (rows.length === 0) {
    return NextResponse.json(
      { error: "이메일(담당자 또는 공식이메일)이 있는 행이 없습니다. 둘 중 하나는 꼭 입력해 주세요." },
      { status: 400 }
    );
  }

  const db = getDb();
  const now = new Date();

  // 이미 등록된 이메일(대기/발송 모두) 스킵
  const emails = rows.map((r) => r.contactEmail);
  const existing = await db
    .select({ contactEmail: prospects.contactEmail })
    .from(prospects)
    .where(and(eq(prospects.userId, userId), inArray(prospects.contactEmail, emails)));
  const existingSet = new Set(existing.map((e) => e.contactEmail));

  const toInsert = rows.filter((r) => !existingSet.has(r.contactEmail));
  if (toInsert.length > 0) {
    await db.insert(prospects).values(
      toInsert.map((r) => ({
        userId,
        clientName: r.clientName.trim(),
        contactName: r.contactName.trim(),
        contactEmail: r.contactEmail,
        officialEmail: r.officialEmail,
        website: r.website.trim(),
        memo: r.memo.trim(),
        importance: r.importance,
        createdAt: now,
        updatedAt: now,
      }))
    );
  }

  return NextResponse.json({
    inserted: toInsert.length,
    skipped: rows.length - toInsert.length + requestDup,
    invalid,
  });
}
