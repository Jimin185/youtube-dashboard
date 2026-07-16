import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, ensureSchema, schema } from "@/lib/db";
import { getUserId } from "@/lib/session";
import { syncAccount } from "@/lib/mail/sync";

export const maxDuration = 300; // 메일 동기화는 오래 걸릴 수 있음

/** 내 계정 수동 동기화 */
export async function POST() {
  await ensureSchema();
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const db = getDb();
  const accounts = await db
    .select()
    .from(schema.mailAccounts)
    .where(eq(schema.mailAccounts.userId, userId));
  if (accounts.length === 0) {
    return NextResponse.json(
      { error: "먼저 설정에서 하이웍스 메일 계정을 연결해 주세요." },
      { status: 400 }
    );
  }

  const results = [];
  for (const account of accounts) {
    results.push(await syncAccount(account));
  }
  return NextResponse.json({ results });
}
