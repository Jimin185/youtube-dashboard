import { NextResponse } from "next/server";
import { z } from "zod";
import { eq, inArray } from "drizzle-orm";
import { getDb, ensureSchema, schema } from "@/lib/db";
import { getUserId } from "@/lib/session";
import { sendToOutbounds } from "@/lib/mail/send";

const { outbounds, mailAccounts } = schema;

export const maxDuration = 300; // 일괄 발송은 오래 걸릴 수 있음

const bodySchema = z.object({
  outboundIds: z.array(z.number().int()).min(1, "받는 사람을 선택하세요."),
  subject: z.string().default(""),
  body: z.string().min(1, "본문을 입력하세요."),
});

/** 선택한 아웃바운드에 메일 발송 (단건/일괄 공용). 내 메일 계정으로만 발송 가능 */
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
  const { outboundIds, subject, body } = parsed.data;

  const db = getDb();
  const myAccounts = await db
    .select()
    .from(mailAccounts)
    .where(eq(mailAccounts.userId, userId));
  if (myAccounts.length === 0) {
    return NextResponse.json(
      { error: "먼저 설정에서 메일 계정을 연결해 주세요." },
      { status: 400 }
    );
  }
  const myAccountIds = myAccounts.map((a) => a.id);

  const targets = await db.select().from(outbounds).where(inArray(outbounds.id, outboundIds));
  const notMine = targets.filter((t) => !myAccountIds.includes(t.accountId));
  if (notMine.length > 0) {
    return NextResponse.json(
      { error: "다른 팀원 계정의 아웃바운드가 포함되어 있습니다. 본인 건만 발송할 수 있어요." },
      { status: 403 }
    );
  }

  // 계정별로 묶어서 발송
  const results = [];
  for (const account of myAccounts) {
    const mine = targets.filter((t) => t.accountId === account.id);
    if (mine.length === 0) continue;
    results.push(...(await sendToOutbounds(account, mine, subject, body)));
  }

  const sent = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  return NextResponse.json({ sent, failed });
}
