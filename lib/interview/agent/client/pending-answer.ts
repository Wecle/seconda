export type PendingAnswer = {
  localId: string;
  idempotencyKey: string;
  content: string;
};

type AnswerStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function loadPendingAnswer(storage: AnswerStorage, interviewId: string): PendingAnswer | null {
  try {
    const parsed = JSON.parse(storage.getItem(storageKey(interviewId)) ?? "null") as unknown;
    if (!isPendingAnswer(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function savePendingAnswer(storage: AnswerStorage, interviewId: string, answer: PendingAnswer) {
  try {
    storage.setItem(storageKey(interviewId), JSON.stringify(answer));
  } catch {}
}

export function clearPendingAnswer(storage: AnswerStorage, interviewId: string) {
  try {
    storage.removeItem(storageKey(interviewId));
  } catch {}
}

function storageKey(interviewId: string) {
  return `seconda:pending-answer:v1:${interviewId}`;
}

function isPendingAnswer(value: unknown): value is PendingAnswer {
  if (!value || typeof value !== "object") return false;
  const answer = value as Partial<PendingAnswer>;
  return typeof answer.localId === "string"
    && UUID_PATTERN.test(answer.localId)
    && typeof answer.idempotencyKey === "string"
    && UUID_PATTERN.test(answer.idempotencyKey)
    && typeof answer.content === "string"
    && answer.content.trim().length > 0
    && answer.content.length <= 20_000;
}
