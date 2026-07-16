import { NextResponse } from "next/server";
import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import { getDb, ensureSchema, schema } from "@/lib/db";
import { getUserId } from "@/lib/session";

const { outbounds, messages } = schema;

type Params = { params: Promise<{ id: string }> };

/** 아웃바운드 상세 + 메일 스레드 */
export async function GET(_req: Request, { params }: Params) {
  await ensureSchema();
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const id = Number((await params).id);
  const db = getDb();
  const rows = await db.select().from(outbounds).where(eq(outbounds.id, id)).limit(1);
  if (rows.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });

  const thread = await db
    .select()
    .from(messages)
    .where(eq(messages.outboundId, id))
    .orderBy(asc(messages.date));

  return NextResponse.json({ item: rows[0], messages: thread });
}

const patchSchema = z.object({
  clientName: z.string().optional(),
  contactName: z.string().optional(),
  importance: z.number().int().min(0).max(3).optional(),
  officialEmail: z.string().optional(),
  website: z.string().optional(),
  memo: z.string().optional(),
  status: z.enum(["active", "replied", "closed"]).optional(),
});

/** 직접 입력 필드 수정 (중요도/공식이메일/사이트/메모/상태 등) */
export async function PATCH(req: Request, { params }: Params) {
  await ensureSchema();
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const id = Number((await params).id);
  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "입력값이 올바르지 않습니다." }, { status: 400 });
  }

  const db = getDb();
  const updates: Record<string, unknown> = { ...parsed.data, updatedAt: new Date() };
  // 수동으로 답변수신 체크하는 경우
  if (parsed.data.status === "replied") updates.repliedAt = new Date();
  if (parsed.data.status === "active") updates.repliedAt = null;

  const updated = await db.update(outbounds).set(updates).where(eq(outbounds.id, id)).returning();
  if (updated.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ item: updated[0] });
}
