import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, ensureSchema, schema } from "@/lib/db";
import { getUserId } from "@/lib/session";
import { encrypt } from "@/lib/crypto";
import { testImapConnection } from "@/lib/mail/sync";

const { mailAccounts } = schema;

export async function GET() {
  await ensureSchema();
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const db = getDb();
  const rows = await db.select().from(mailAccounts).where(eq(mailAccounts.userId, userId));
  return NextResponse.json({
    accounts: rows.map((a) => ({
      id: a.id,
      email: a.email,
      imapHost: a.imapHost,
      imapPort: a.imapPort,
      smtpHost: a.smtpHost,
      smtpPort: a.smtpPort,
      username: a.username,
      lastSyncAt: a.lastSyncAt,
      lastSyncError: a.lastSyncError,
    })),
  });
}

const bodySchema = z.object({
  email: z.string().email("메일 주소 형식이 올바르지 않습니다."),
  password: z.string().min(1, "메일 비밀번호를 입력하세요."),
  imapHost: z.string().min(1).default("imap.hiworks.com"),
  imapPort: z.coerce.number().default(993),
  smtpHost: z.string().min(1).default("smtp.hiworks.com"),
  smtpPort: z.coerce.number().default(465),
});

/** 하이웍스 계정 연결(생성/수정) + 연결 테스트 */
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
  const { email, password, imapHost, imapPort, smtpHost, smtpPort } = parsed.data;

  const db = getDb();
  const now = new Date();
  const values = {
    userId,
    email: email.toLowerCase(),
    username: email.toLowerCase(), // 하이웍스는 메일 전체 주소가 아이디
    passwordEnc: encrypt(password),
    imapHost,
    imapPort,
    smtpHost,
    smtpPort,
  };

  const existing = await db.select().from(mailAccounts).where(eq(mailAccounts.userId, userId));
  let account;
  if (existing.length > 0) {
    const updated = await db
      .update(mailAccounts)
      .set(values)
      .where(eq(mailAccounts.id, existing[0].id))
      .returning();
    account = updated[0];
  } else {
    const inserted = await db
      .insert(mailAccounts)
      .values({ ...values, createdAt: now })
      .returning();
    account = inserted[0];
  }

  // 저장 즉시 IMAP 접속 테스트
  try {
    await testImapConnection(account);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        ok: false,
        saved: true,
        error: `저장은 되었지만 메일 서버 접속에 실패했습니다: ${msg}. 하이웍스에서 IMAP 사용 설정을 확인해 주세요.`,
      },
      { status: 200 }
    );
  }

  return NextResponse.json({ ok: true, saved: true });
}
