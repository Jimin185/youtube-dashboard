import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as {
  __libsql?: Client;
  __dbReady?: Promise<void>;
};

function getClient(): Client {
  if (!globalForDb.__libsql) {
    const url = process.env.DATABASE_URL ?? "file:./data/outbound.db";
    globalForDb.__libsql = createClient({
      url,
      authToken: process.env.DATABASE_AUTH_TOKEN,
    });
  }
  return globalForDb.__libsql;
}

const DDL = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS mail_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    email TEXT NOT NULL,
    imap_host TEXT NOT NULL DEFAULT 'imap.hiworks.com',
    imap_port INTEGER NOT NULL DEFAULT 993,
    smtp_host TEXT NOT NULL DEFAULT 'smtp.hiworks.com',
    smtp_port INTEGER NOT NULL DEFAULT 465,
    username TEXT NOT NULL,
    password_enc TEXT NOT NULL,
    last_sync_at INTEGER,
    sync_state TEXT NOT NULL DEFAULT '{}',
    last_sync_error TEXT,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS outbounds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL REFERENCES mail_accounts(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    client_name TEXT NOT NULL DEFAULT '',
    contact_name TEXT NOT NULL DEFAULT '',
    contact_email TEXT NOT NULL,
    subject TEXT NOT NULL DEFAULT '',
    normalized_subject TEXT NOT NULL DEFAULT '',
    first_sent_at INTEGER NOT NULL,
    last_sent_at INTEGER NOT NULL,
    stage INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'active',
    replied_at INTEGER,
    importance INTEGER NOT NULL DEFAULT 0,
    official_email TEXT NOT NULL DEFAULT '',
    website TEXT NOT NULL DEFAULT '',
    memo TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    outbound_id INTEGER NOT NULL REFERENCES outbounds(id),
    direction TEXT NOT NULL,
    message_id TEXT NOT NULL DEFAULT '',
    in_reply_to TEXT NOT NULL DEFAULT '',
    subject TEXT NOT NULL DEFAULT '',
    from_addr TEXT NOT NULL DEFAULT '',
    to_addr TEXT NOT NULL DEFAULT '',
    date INTEGER NOT NULL,
    snippet TEXT NOT NULL DEFAULT '',
    body_text TEXT NOT NULL DEFAULT '',
    body_html TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  )`,
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
        await client.execute(stmt);
      }
    })();
  }
  return globalForDb.__dbReady;
}

export function getDb() {
  return drizzle(getClient(), { schema });
}

export { schema };
