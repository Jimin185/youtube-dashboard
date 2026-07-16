import { and, eq } from "drizzle-orm";
import { getDb, schema } from "./db";

const { prospects, outbounds } = schema;

/**
 * 보낼 목록(대기) ↔ 보낸 목록(아웃바운드) 자동 연결.
 * Gmail에서 직접 메일을 보낸 경우, 동기화로 생긴 아웃바운드와
 * 대기 중인 보낼 목록을 이메일 주소로 매칭해서:
 *  - 보낼 목록에 적어둔 클라이언트/공식이메일/사이트/메모/중요도를 아웃바운드에 복사
 *  - 보낼 목록 항목을 '발송됨' 처리
 */
export async function reconcileProspects(userId: number): Promise<number> {
  const db = getDb();
  const pending = await db
    .select()
    .from(prospects)
    .where(and(eq(prospects.userId, userId), eq(prospects.status, "pending")));
  if (pending.length === 0) return 0;

  let moved = 0;
  const now = new Date();
  for (const p of pending) {
    const matches = await db
      .select()
      .from(outbounds)
      .where(and(eq(outbounds.userId, userId), eq(outbounds.contactEmail, p.contactEmail)))
      .limit(1);
    if (matches.length === 0) continue;
    const o = matches[0];

    await db
      .update(outbounds)
      .set({
        clientName: p.clientName || o.clientName,
        contactName: o.contactName || p.contactName,
        officialEmail: p.officialEmail || o.officialEmail,
        website: p.website || o.website,
        memo: p.memo || o.memo,
        importance: Math.max(p.importance, o.importance),
        updatedAt: now,
      })
      .where(eq(outbounds.id, o.id));
    await db
      .update(prospects)
      .set({ status: "sent", outboundId: o.id, updatedAt: now })
      .where(eq(prospects.id, p.id));
    moved++;
  }
  return moved;
}
