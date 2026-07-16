import { NextResponse } from "next/server";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { getDb, ensureSchema, schema } from "@/lib/db";
import { getUserId } from "@/lib/session";

const { templates } = schema;

/** 내 메일 템플릿 목록 */
export async function GET() {
  await ensureSchema();
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const db = getDb();
  const rows = await db
    .select()
    .from(templates)
    .where(eq(templates.userId, userId))
    .orderBy(desc(templates.updatedAt));
  return NextResponse.json({ items: rows });
}

const bodySchema = z.object({
  name: z.string().min(1, "템플릿 이름을 입력하세요.").max(50),
  subject: z.string().default(""),
  body: z.string().min(1, "본문이 비어있습니다."),
});

/** 템플릿 저장 (같은 이름이면 덮어쓰기) */
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
  const { name, subject, body } = parsed.data;

  const db = getDb();
  const now = new Date();
  const existing = await db
    .select()
    .from(templates)
    .where(and(eq(templates.userId, userId), eq(templates.name, name)))
    .limit(1);

  if (existing.length > 0) {
    const updated = await db
      .update(templates)
      .set({ subject, body, updatedAt: now })
      .where(eq(templates.id, existing[0].id))
      .returning();
    return NextResponse.json({ item: updated[0], overwritten: true });
  }
  const inserted = await db
    .insert(templates)
    .values({ userId, name, subject, body, createdAt: now, updatedAt: now })
    .returning();
  return NextResponse.json({ item: inserted[0], overwritten: false });
}
