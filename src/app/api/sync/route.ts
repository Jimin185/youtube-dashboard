import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, ensureSchema, schema } from "@/lib/db";
import { getUserId } from "@/lib/session";
import { syncAccount } from "@/lib/mail/sync";

export const maxDuration = 300; // 메일 동기화는 오래 걸릴 수 있음

const AUTO_SYNC_INTERVAL_MS = 30 * 60 * 1000; // 자동 동기화 최소 간격 30분

/**
 * 내 계정 동기화.
 * ?auto=1 이면 대시보드 접속 시 자동 호출된 것 — 최근 30분 내 동기화했으면 스킵.
 */
export async function POST(req: Request) {
  await ensureSchema();
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const isAuto = new URL(req.url).searchParams.get("auto") === "1";

  const db = getDb();
  let accounts = await db
    .select()
    .from(schema.mailAccounts)
    .where(eq(schema.mailAccounts.userId, userId));
  if (accounts.length === 0) {
    if (isAuto) return NextResponse.json({ skipped: true, results: [] });
    return NextResponse.json(
      { error: "먼저 설정에서 메일 계정을 연결해 주세요." },
      { status: 400 }
    );
  }

  if (isAuto) {
    const cutoff = Date.now() - AUTO_SYNC_INTERVAL_MS;
    accounts = accounts.filter(
      (a) => !a.lastSyncAt || new Date(a.lastSyncAt).getTime() < cutoff
    );
    if (accounts.length === 0) return NextResponse.json({ skipped: true, results: [] });
  }

  const results = [];
  for (const account of accounts) {
    results.push(await syncAccount(account));
  }
  return NextResponse.json({ results });
}
