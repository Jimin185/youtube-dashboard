import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, ensureSchema, schema } from "@/lib/db";
import { getSession } from "@/lib/session";

const bodySchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(8, "비밀번호는 8자 이상이어야 합니다."),
  inviteCode: z.string().optional(),
});

export async function POST(req: Request) {
  await ensureSchema();
  const db = getDb();

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "입력값이 올바르지 않습니다." },
      { status: 400 }
    );
  }
  const { email, name, password, inviteCode } = parsed.data;

  // TEAM_INVITE_CODE 가 설정돼 있으면 코드가 맞아야 가입 가능 (외부인 차단)
  const required = process.env.TEAM_INVITE_CODE;
  if (required && inviteCode !== required) {
    return NextResponse.json({ error: "팀 초대 코드가 올바르지 않습니다." }, { status: 403 });
  }

  const existing = await db.select().from(schema.users).where(eq(schema.users.email, email.toLowerCase()));
  if (existing.length > 0) {
    return NextResponse.json({ error: "이미 가입된 이메일입니다." }, { status: 409 });
  }

  const inserted = await db
    .insert(schema.users)
    .values({
      email: email.toLowerCase(),
      name,
      passwordHash: await bcrypt.hash(password, 10),
      createdAt: new Date(),
    })
    .returning();

  const session = await getSession();
  session.userId = inserted[0].id;
  session.name = inserted[0].name;
  session.email = inserted[0].email;
  await session.save();

  return NextResponse.json({ ok: true });
}
