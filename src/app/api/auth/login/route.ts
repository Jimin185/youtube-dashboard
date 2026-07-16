import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, ensureSchema, schema } from "@/lib/db";
import { getSession } from "@/lib/session";

const bodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: Request) {
  await ensureSchema();
  const db = getDb();

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "입력값이 올바르지 않습니다." }, { status: 400 });
  }
  const { email, password } = parsed.data;

  const rows = await db.select().from(schema.users).where(eq(schema.users.email, email.toLowerCase()));
  if (rows.length === 0 || !(await bcrypt.compare(password, rows[0].passwordHash))) {
    return NextResponse.json({ error: "이메일 또는 비밀번호가 올바르지 않습니다." }, { status: 401 });
  }

  const session = await getSession();
  session.userId = rows[0].id;
  session.name = rows[0].name;
  session.email = rows[0].email;
  await session.save();

  return NextResponse.json({ ok: true });
}
