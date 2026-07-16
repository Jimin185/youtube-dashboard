import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { getDb, ensureSchema, schema } from "@/lib/db";
import { getUserId } from "@/lib/session";
import { reminderBucket, nextReminderDate } from "@/lib/outbound";

const { outbounds, users } = schema;

/** 팀 전체 아웃바운드 목록 (+ 리마인드 버킷 계산) */
export async function GET() {
  await ensureSchema();
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const db = getDb();
  const rows = await db
    .select({ outbound: outbounds, ownerName: users.name })
    .from(outbounds)
    .innerJoin(users, eq(outbounds.userId, users.id))
    .orderBy(desc(outbounds.lastSentAt));

  const now = new Date();
  return NextResponse.json({
    items: rows.map(({ outbound: o, ownerName }) => ({
      ...o,
      ownerName,
      isMine: o.userId === userId,
      reminderBucket: reminderBucket(o, now),
      nextReminderAt: nextReminderDate(o),
    })),
  });
}
