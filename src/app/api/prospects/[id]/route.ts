import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getDb, ensureSchema, schema } from "@/lib/db";
import { getUserId } from "@/lib/session";

const { prospects } = schema;

type Params = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  clientName: z.string().optional(),
  contactName: z.string().optional(),
  officialEmail: z.string().optional(),
  website: z.string().optional(),
  memo: z.string().optional(),
  importance: z.number().int().min(0).max(3).optional(),
});

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
  const updated = await db
    .update(prospects)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(and(eq(prospects.id, id), eq(prospects.userId, userId)))
    .returning();
  if (updated.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ item: updated[0] });
}

export async function DELETE(_req: Request, { params }: Params) {
  await ensureSchema();
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const id = Number((await params).id);
  const db = getDb();
  const deleted = await db
    .delete(prospects)
    .where(and(eq(prospects.id, id), eq(prospects.userId, userId)))
    .returning({ id: prospects.id });
  if (deleted.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
