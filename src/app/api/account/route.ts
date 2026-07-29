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
      fromName: a.fromName,
      fromEmail: a.fromEmail,
      signature: a.signature,
      lastSyncAt: a.lastSyncAt,
      lastSyncError: a.lastSyncError,
    })),
  });
}

const bodySchema = z.object({
  email: z.string().email("메일 주소 형식이 올바르지 않습니다."),
  password: z.string().min(1, "앱 비밀번호를 입력하세요."),
  imapHost: z.string().min(1).default("imap.gmail.com"),
  imapPort: z.coerce.number().default(993),
  smtpHost: z.string().min(1).default("smtp.gmail.com"),
  smtpPort: z.coerce.number().default(465),
  fromName: z.string().max(100).default(""),
  fromEmail: z
    .string()
    .email("발신 주소 형식이 올바르지 않습니다.")
    .or(z.literal(""))
    .default(""),
  signature: z.string().max(2000).default(""),
});

/** 메일 계정 연결(생성/수정) + 연결 테스트 */
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
  const { email, password, imapHost, imapPort, smtpHost, smtpPort, fromName, fromEmail, signature } =
    parsed.data;

  const db = getDb();
  const now = new Date();
  const values = {
    userId,
    email: email.toLowerCase(),
    username: email.toLowerCase(), // Gmail/하이웍스 모두 메일 전체 주소가 아이디
    passwordEnc: encrypt(password.replace(/\s/g, "")), // 앱 비밀번호는 공백 제거
    imapHost,
    imapPort,
    smtpHost,
    smtpPort,
    fromName: fromName.trim(),
    fromEmail: fromEmail.trim().toLowerCase(),
    signature,
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
    // 로그인 거부 시 imapflow는 'Command failed' 류의 모호한 메시지를 준다 → 서버별로 친절하게 번역
    const isAuthError = /command failed|authenticat|invalid credentials|login|application-specific/i.test(msg);
    const isGmailHost = account.imapHost.includes("gmail");
    const isGmailAddr = account.email.endsWith("@gmail.com");
    let friendly: string;
    if (isAuthError && isGmailHost) {
      friendly =
        `Gmail이 로그인을 거부했습니다 (시도한 계정: ${account.email}). 순서대로 확인해 주세요: ` +
        `① 맨 위 '메일 주소' 칸에는 실제 Gmail 주소가 들어가야 해요` +
        (!isGmailAddr
          ? ` — 지금은 Gmail 주소가 아닌 것 같아요! 회사 메일은 아래 '발신 주소' 칸에만 넣어주세요.`
          : `.`) +
        ` ② 비밀번호는 Gmail 로그인 비밀번호가 아니라, 그 Gmail 계정의 2단계 인증을 켠 뒤 ` +
        `myaccount.google.com/apppasswords 에서 만든 16자리 '앱 비밀번호'여야 합니다.`;
    } else if (isAuthError) {
      friendly =
        `메일 서버(${account.imapHost})가 로그인을 거부했습니다 (시도한 계정: ${account.email}). ` +
        `확인사항: ① 비밀번호가 '메일 전용 비밀번호'(외부 메일 프로그램용)인지 ② 그 서버에서 IMAP 사용이 허용돼 있는지 ` +
        `— 하이웍스라면 관리자가 IMAP을 꺼놨을 수 있어요 (POP3만 허용된 경우에도 이 오류가 납니다).`;
    } else if (/getaddrinfo|ENOTFOUND|EAI_AGAIN/i.test(msg)) {
      friendly = `서버 주소(${account.imapHost})를 찾을 수 없습니다. 고급 설정의 IMAP 서버 주소를 확인해 주세요.`;
    } else {
      friendly = `메일 서버 접속에 실패했습니다: ${msg}`;
    }
    return NextResponse.json(
      { ok: false, saved: true, error: `저장은 되었습니다. 하지만 ${friendly}` },
      { status: 200 }
    );
  }

  return NextResponse.json({ ok: true, saved: true });
}
