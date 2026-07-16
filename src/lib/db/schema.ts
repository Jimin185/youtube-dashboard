import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

// 팀원 계정
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

// 각 팀원이 연결한 메일 계정 (기본: Gmail, 다른 IMAP 메일도 가능)
export const mailAccounts = pgTable("mail_accounts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  email: text("email").notNull(),
  imapHost: text("imap_host").notNull().default("imap.gmail.com"),
  imapPort: integer("imap_port").notNull().default(993),
  smtpHost: text("smtp_host").notNull().default("smtp.gmail.com"),
  smtpPort: integer("smtp_port").notNull().default(465),
  username: text("username").notNull(),
  passwordEnc: text("password_enc").notNull(),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  syncState: text("sync_state").notNull().default("{}"),
  lastSyncError: text("last_sync_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

// 아웃바운드 1건 = 클라이언트(담당자) 1명에게 진행 중인 영업 스레드
export const outbounds = pgTable("outbounds", {
  id: serial("id").primaryKey(),
  accountId: integer("account_id")
    .notNull()
    .references(() => mailAccounts.id),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  clientName: text("client_name").notNull().default(""),
  contactName: text("contact_name").notNull().default(""),
  contactEmail: text("contact_email").notNull(),
  subject: text("subject").notNull().default(""),
  normalizedSubject: text("normalized_subject").notNull().default(""),
  firstSentAt: timestamp("first_sent_at", { withTimezone: true }).notNull(),
  lastSentAt: timestamp("last_sent_at", { withTimezone: true }).notNull(),
  // 1 = 1차 발송, 2 = 2차 리마인드 발송됨, 3 = 3차 리마인드 발송됨
  stage: integer("stage").notNull().default(1),
  // active = 답변 대기중, replied = 답변수신, closed = 완료/제외
  status: text("status").notNull().default("active"),
  repliedAt: timestamp("replied_at", { withTimezone: true }),
  // 직접 입력 필드
  importance: integer("importance").notNull().default(0), // 0~3 (★)
  officialEmail: text("official_email").notNull().default(""),
  website: text("website").notNull().default(""),
  memo: text("memo").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

// 아웃바운드에 속한 실제 메일(보낸 것/받은 것)
export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  outboundId: integer("outbound_id")
    .notNull()
    .references(() => outbounds.id),
  direction: text("direction").notNull(), // sent | received
  messageId: text("message_id").notNull().default(""),
  inReplyTo: text("in_reply_to").notNull().default(""),
  subject: text("subject").notNull().default(""),
  fromAddr: text("from_addr").notNull().default(""),
  toAddr: text("to_addr").notNull().default(""),
  date: timestamp("date", { withTimezone: true }).notNull(),
  snippet: text("snippet").notNull().default(""),
  bodyText: text("body_text").notNull().default(""),
  bodyHtml: text("body_html").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export type User = typeof users.$inferSelect;
export type MailAccount = typeof mailAccounts.$inferSelect;
export type Outbound = typeof outbounds.$inferSelect;
export type MailMessage = typeof messages.$inferSelect;
