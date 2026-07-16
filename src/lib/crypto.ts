import crypto from "crypto";

// 메일 비밀번호(앱 비밀번호)를 DB에 저장할 때 AES-256-GCM으로 암호화한다.
// APP_SECRET 환경변수가 키 역할을 한다.

function getKey(): Buffer {
  const secret = process.env.APP_SECRET;
  if (!secret) {
    throw new Error("APP_SECRET 환경변수가 설정되지 않았습니다.");
  }
  return crypto.createHash("sha256").update(secret).digest();
}

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(".");
}

export function decrypt(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(".");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    getKey(),
    Buffer.from(ivB64, "base64")
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
