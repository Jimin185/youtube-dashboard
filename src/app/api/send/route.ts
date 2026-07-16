import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, ensureSchema, schema } from "@/lib/db";
import { getUserId } from "@/lib/session";
import { sendToOutbounds } from "@/lib/mail/send";
import { normalizeSubject, renderTemplate } from "@/lib/outbound";
import type { Outbound } from "@/lib/db/schema";

const { outbounds, mailAccounts, prospects, messages } = schema;

export const maxDuration = 300; // 일괄 발송은 오래 걸릴 수 있음

const bodySchema = z.object({
  outboundIds: z.array(z.number().int()).default([]),
  prospectIds: z.array(z.number().int()).default([]),
  subject: z.string().default(""),
  body: z.string().min(1, "본문을 입력하세요."),
});

/**
 * 메일 발송 (단건/일괄 공용).
 * - outboundIds: 기존 아웃바운드에 리마인드/답장 (스레드 유지)
 * - prospectIds: 보낼 목록의 신규 발송 → 성공 시 아웃바운드 생성 + 보낸 목록으로 이동
 */
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
  const { outboundIds, prospectIds, subject, body } = parsed.data;
  if (outboundIds.length === 0 && prospectIds.length === 0) {
    return NextResponse.json({ error: "받는 사람을 선택하세요." }, { status: 400 });
  }
  if (prospectIds.length > 0 && !subject.trim()) {
    return NextResponse.json(
      { error: "신규 발송은 제목이 필요합니다." },
      { status: 400 }
    );
  }

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
  const primaryAccount = myAccounts[0];
  const now = new Date();

  const results: { outboundId: number; ok: boolean; error?: string }[] = [];

  // ── 1) 기존 아웃바운드에 발송 (리마인드/답장) ──
  if (outboundIds.length > 0) {
    const targets = await db.select().from(outbounds).where(inArray(outbounds.id, outboundIds));
    const notMine = targets.filter((t) => !myAccountIds.includes(t.accountId));
    if (notMine.length > 0) {
      return NextResponse.json(
        { error: "다른 팀원 계정의 아웃바운드가 포함되어 있습니다. 본인 건만 발송할 수 있어요." },
        { status: 403 }
      );
    }
    for (const account of myAccounts) {
      const mine = targets.filter((t) => t.accountId === account.id);
      if (mine.length === 0) continue;
      results.push(...(await sendToOutbounds(account, mine, subject, body)));
    }
  }

  // ── 2) 보낼 목록 신규 발송 ──
  let movedProspects = 0;
  if (prospectIds.length > 0) {
    const targets = await db
      .select()
      .from(prospects)
      .where(
        and(
          inArray(prospects.id, prospectIds),
          eq(prospects.userId, userId),
          eq(prospects.status, "pending")
        )
      );

    for (const p of targets) {
      // 발송 전 아웃바운드 생성 (stage 0 → 발송 성공 시 1차가 됨)
      const pseudo = {
        contactName: p.contactName,
        clientName: p.clientName,
        contactEmail: p.contactEmail,
        subject: "",
      } as Outbound;
      const renderedSubject = renderTemplate(subject, pseudo);

      const inserted = await db
        .insert(outbounds)
        .values({
          accountId: primaryAccount.id,
          userId,
          clientName: p.clientName,
          contactName: p.contactName,
          contactEmail: p.contactEmail,
          subject: renderedSubject,
          normalizedSubject: normalizeSubject(renderedSubject),
          firstSentAt: now,
          lastSentAt: now,
          stage: 0,
          status: "active",
          importance: p.importance,
          officialEmail: p.officialEmail,
          website: p.website,
          memo: p.memo,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      const outbound = inserted[0];

      const [result] = await sendToOutbounds(primaryAccount, [outbound], subject, body);
      if (result.ok) {
        await db
          .update(prospects)
          .set({ status: "sent", outboundId: outbound.id, updatedAt: new Date() })
          .where(eq(prospects.id, p.id));
        movedProspects++;
        results.push(result);
      } else {
        // 발송 실패 시 만들다 만 아웃바운드 제거 (보낼 목록에 그대로 남음)
        await db.delete(messages).where(eq(messages.outboundId, outbound.id));
        await db.delete(outbounds).where(eq(outbounds.id, outbound.id));
        results.push(result);
      }
    }
  }

  const sent = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  console.log(
    `[send] user=${userId} sent=${sent} failed=${failed.length}` +
      (failed.length > 0 ? ` errors=${failed.slice(0, 3).map((f) => f.error).join(" | ")}` : "")
  );
  return NextResponse.json({ sent, failed, movedProspects });
}
