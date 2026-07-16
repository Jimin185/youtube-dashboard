// API 응답용 프론트엔드 타입 (날짜는 JSON 직렬화되어 string으로 온다)
export interface OutboundItem {
  id: number;
  accountId: number;
  userId: number;
  clientName: string;
  contactName: string;
  contactEmail: string;
  subject: string;
  firstSentAt: string;
  lastSentAt: string;
  stage: number;
  status: "active" | "replied" | "closed";
  repliedAt: string | null;
  importance: number;
  officialEmail: string;
  website: string;
  memo: string;
  ownerName: string;
  isMine: boolean;
  reminderBucket: "second" | "third" | null;
  nextReminderAt: string | null;
}

export interface ThreadMessage {
  id: number;
  direction: "sent" | "received";
  subject: string;
  fromAddr: string;
  toAddr: string;
  date: string;
  snippet: string;
  bodyText: string;
  bodyHtml: string;
}

export type TabKey = "prospects" | "all" | "replied" | "second" | "third" | "closed" | "db";

export function formatDate(d: string | null): string {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("ko-KR", {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
  });
}
