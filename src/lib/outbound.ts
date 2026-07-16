import type { Outbound } from "./db/schema";

export const SECOND_REMINDER_DAYS = 15; // 2차: 1차 발송 15일 후
export const THIRD_REMINDER_DAYS = 30; // 3차: 1차 발송 한달 후

const DAY_MS = 24 * 60 * 60 * 1000;

/** Re:, Fwd:, [광고] 등 접두어를 제거해 스레드 매칭용 제목을 만든다 */
export function normalizeSubject(subject: string): string {
  return subject
    .replace(/^(\s*((re|fw|fwd|답장|회신|전달)\s*:)\s*)+/i, "")
    .trim()
    .toLowerCase();
}

export type ReminderBucket = "second" | "third" | null;

/** 이 아웃바운드가 현재 몇 차 리마인드 대상인지 계산 */
export function reminderBucket(o: Outbound, now: Date = new Date()): ReminderBucket {
  if (o.status !== "active") return null;
  const elapsed = now.getTime() - new Date(o.firstSentAt).getTime();
  if (o.stage === 1 && elapsed >= SECOND_REMINDER_DAYS * DAY_MS) return "second";
  if (o.stage === 2 && elapsed >= THIRD_REMINDER_DAYS * DAY_MS) return "third";
  return null;
}

/** 리마인드 예정일 (다음 액션 날짜). 대상이 아니면 null */
export function nextReminderDate(o: Outbound): Date | null {
  if (o.status !== "active" || o.stage >= 3) return null;
  const days = o.stage === 1 ? SECOND_REMINDER_DAYS : THIRD_REMINDER_DAYS;
  return new Date(new Date(o.firstSentAt).getTime() + days * DAY_MS);
}

/**
 * 템플릿 변수 치환. 두 가지 표기 모두 지원:
 *  - [기업명] [회사명] [클라이언트] → 클라이언트명 (없으면 이메일 도메인에서 유추)
 *  - [담당자] [담당자명] [이름]     → 담당자 이름 (없으면 "담당자")
 *  - {{...}} 표기도 동일하게 동작
 */
export function renderTemplate(template: string, o: Outbound): string {
  const client =
    o.clientName || o.contactEmail.split("@")[1]?.split(".")[0] || "";
  const contact = o.contactName || "담당자";
  return template
    .replace(/\[\s*(담당자명?|이름)\s*\]|\{\{\s*(담당자명?|이름)\s*\}\}/g, contact)
    .replace(/\[\s*(기업명|회사명?|클라이언트)\s*\]|\{\{\s*(기업명|회사명?|클라이언트)\s*\}\}/g, client)
    .replaceAll("{{제목}}", o.subject);
}

/** 템플릿에 기업명/담당자 변수가 들어있는지 (발송 전 경고용) */
export function templateVars(template: string): { client: boolean; contact: boolean } {
  return {
    client: /\[\s*(기업명|회사명?|클라이언트)\s*\]|\{\{\s*(기업명|회사명?|클라이언트)\s*\}\}/.test(template),
    contact: /\[\s*(담당자명?|이름)\s*\]|\{\{\s*(담당자명?|이름)\s*\}\}/.test(template),
  };
}
