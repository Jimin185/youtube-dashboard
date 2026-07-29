import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getDb, ensureSchema, schema } from "@/lib/db";
import { getUserId } from "@/lib/session";
import { normalizeSubject } from "@/lib/outbound";

const { prospects, outbounds, mailAccounts } = schema;

type Params = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  clientName: z.string().optional(),
  contactName: z.string().optional(),
  officialEmail: z.string().optional(),
  website: z.string().optional(),
  memo: z.string().optional(),
  importance: z.number().int().min(0).max(3).optional(),
  // 지정하면 이 항목을 보낸 목록(아웃바운드)으로 이동시킨다
  moveTo: z.enum(["active", "replied", "closed"]).optional(),
  stage: z.number().int().min(1).max(3).optional(),
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
  const { moveTo, stage, ...fields } = parsed.data;
  const db = getDb();

  // ── 보낼 목록 → 보낸 목록 수동 이동 ("이미 보낸 곳이었음" 처리) ──
  if (moveTo) {
    const rows = await db
      .select()
      .from(prospects)
      .where(and(eq(prospects.id, id), eq(prospects.userId, userId), eq(prospects.status, "pending")))
      .limit(1);
    if (rows.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
    const p = rows[0];

    const myAccounts = await db.select().from(mailAccounts).where(eq(mailAccounts.userId, userId));
    if (myAccounts.length === 0) {
      return NextResponse.json(
        { error: "보낸 목록으로 옮기려면 먼저 설정에서 메일 계정을 연결해 주세요." },
        { status: 400 }
      );
    }

    const now = new Date();
    // 같은 이메일의 아웃바운드가 이미 있으면 새로 만들지 않고 연결만
    const existing = await db
      .select()
      .from(outbounds)
      .where(and(eq(outbounds.userId, userId), eq(outbounds.contactEmail, p.contactEmail)))
      .limit(1);

    let outboundId: number;
    if (existing.length > 0) {
      outboundId = existing[0].id;
    } else {
      const inserted = await db
        .insert(outbounds)
        .values({
          accountId: myAccounts[0].id,
          userId,
          clientName: p.clientName,
          contactName: p.contactName,
          contactEmail: p.contactEmail,
          subject: "",
          normalizedSubject: normalizeSubject(""),
          firstSentAt: now,
          lastSentAt: now,
          stage: stage ?? 1,
          status: moveTo,
          repliedAt: moveTo === "replied" ? now : null,
          importance: p.importance,
          officialEmail: p.officialEmail,
          website: p.website,
          memo: p.memo,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: outbounds.id });
      outboundId = inserted[0].id;
    }

    await db
      .update(prospects)
      .set({ status: "sent", outboundId, updatedAt: now })
      .where(eq(prospects.id, p.id));
    return NextResponse.json({ moved: true, outboundId });
  }

  // ── 일반 필드 수정 ──
  const updated = await db
    .update(prospects)
    .set({ ...fields, updatedAt: new Date() })
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
