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

/** 템플릿 변수 치환: {{담당자}}, {{클라이언트}}, {{제목}} */
export function renderTemplate(template: string, o: Outbound): string {
  return template
    .replaceAll("{{담당자}}", o.contactName || "담당자")
    .replaceAll("{{클라이언트}}", o.clientName || o.contactEmail.split("@")[1] || "")
    .replaceAll("{{제목}}", o.subject);
}
