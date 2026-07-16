import { NextResponse } from "next/server";
import { getDb, ensureSchema, schema } from "@/lib/db";
import { syncAccount } from "@/lib/mail/sync";

export const maxDuration = 300;

/** Vercel Cron 이 주기적으로 호출: 모든 팀원 계정 자동 동기화 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  await ensureSchema();
  const db = getDb();
  const accounts = await db.select().from(schema.mailAccounts);

  const results = [];
  for (const account of accounts) {
    results.push(await syncAccount(account));
  }
  return NextResponse.json({ results });
}
