import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as {
  __pgClient?: ReturnType<typeof postgres>;
  __dbReady?: Promise<void>;
};

function getClient() {
  if (!globalForDb.__pgClient) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error(
        "DATABASE_URL 환경변수가 없습니다. Supabase 프로젝트의 연결 문자열(Transaction pooler)을 설정해 주세요."
      );
    }
    globalForDb.__pgClient = postgres(url, {
      // Supabase transaction pooler(포트 6543)는 prepared statement를 지원하지 않음
      prepare: false,
      max: 5,
    });
  }
  return globalForDb.__pgClient;
}

const DDL = [
  `CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS mail_accounts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    email TEXT NOT NULL,
    imap_host TEXT NOT NULL DEFAULT 'imap.gmail.com',
    imap_port INTEGER NOT NULL DEFAULT 993,
    smtp_host TEXT NOT NULL DEFAULT 'smtp.gmail.com',
    smtp_port INTEGER NOT NULL DEFAULT 465,
    username TEXT NOT NULL,
    password_enc TEXT NOT NULL,
    last_sync_at TIMESTAMPTZ,
    sync_state TEXT NOT NULL DEFAULT '{}',
    last_sync_error TEXT,
    created_at TIMESTAMPTZ NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS outbounds (
    id SERIAL PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES mail_accounts(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    client_name TEXT NOT NULL DEFAULT '',
    contact_name TEXT NOT NULL DEFAULT '',
    contact_email TEXT NOT NULL,
    subject TEXT NOT NULL DEFAULT '',
    normalized_subject TEXT NOT NULL DEFAULT '',
    first_sent_at TIMESTAMPTZ NOT NULL,
    last_sent_at TIMESTAMPTZ NOT NULL,
    stage INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'active',
    replied_at TIMESTAMPTZ,
    importance INTEGER NOT NULL DEFAULT 0,
    official_email TEXT NOT NULL DEFAULT '',
    website TEXT NOT NULL DEFAULT '',
    memo TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    outbound_id INTEGER NOT NULL REFERENCES outbounds(id),
    direction TEXT NOT NULL,
    message_id TEXT NOT NULL DEFAULT '',
    in_reply_to TEXT NOT NULL DEFAULT '',
    subject TEXT NOT NULL DEFAULT '',
    from_addr TEXT NOT NULL DEFAULT '',
    to_addr TEXT NOT NULL DEFAULT '',
    date TIMESTAMPTZ NOT NULL,
    snippet TEXT NOT NULL DEFAULT '',
    body_text TEXT NOT NULL DEFAULT '',
    body_html TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS prospects (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    client_name TEXT NOT NULL DEFAULT '',
    contact_name TEXT NOT NULL DEFAULT '',
    contact_email TEXT NOT NULL,
    official_email TEXT NOT NULL DEFAULT '',
    website TEXT NOT NULL DEFAULT '',
    memo TEXT NOT NULL DEFAULT '',
    importance INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    outbound_id INTEGER,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS templates (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    subject TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_templates_user ON templates(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_prospects_user ON prospects(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_prospects_email ON prospects(contact_email)`,
  `CREATE INDEX IF NOT EXISTS idx_outbounds_account ON outbounds(account_id)`,
  `CREATE INDEX IF NOT EXISTS idx_outbounds_email ON outbounds(contact_email)`,
  `CREATE INDEX IF NOT EXISTS idx_messages_outbound ON messages(outbound_id)`,
  `CREATE INDEX IF NOT EXISTS idx_messages_message_id ON messages(message_id)`,
];

/** 앱 첫 요청 시 테이블을 보장한다 (idempotent). */
export async function ensureSchema(): Promise<void> {
  if (!globalForDb.__dbReady) {
    const client = getClient();
    globalForDb.__dbReady = (async () => {
      for (const stmt of DDL) {
        await client.unsafe(stmt);
      }
    })().catch((err) => {
      // 일시적 DB 장애가 영구 실패로 캐시되지 않도록 초기화
      globalForDb.__dbReady = undefined;
      throw err;
    });
  }
  return globalForDb.__dbReady;
}

export function getDb() {
  return drizzle(getClient(), { schema });
}

export { schema };
