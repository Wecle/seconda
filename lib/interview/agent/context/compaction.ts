export type CompactMessage = {
  groupId: string;
  role: string;
  kind: string;
  content: string;
  toolCallId?: string;
};

export type CompactSummary = {
  summary: string;
  resumeEvidenceIds: string[];
  activeThreads: string[];
};

export function shouldCompactContext(input: {
  candidateRoundCount: number;
  lastCompactedRound: number;
  tokenEstimate: number;
  effectiveBudget: number;
}) {
  const roundsSinceCompaction = input.candidateRoundCount - input.lastCompactedRound;
  const underTokenPressure = input.effectiveBudget > 0
    && input.tokenEstimate >= input.effectiveBudget * 0.9;
  return roundsSinceCompaction >= 5 || underTokenPressure;
}

export function truncateOldestCompleteGroups(
  messages: CompactMessage[],
  groupsToRemove: number,
) {
  if (groupsToRemove <= 0) return [...messages];
  const orderedGroups = Array.from(new Set(messages.map((message) => message.groupId)));
  const removedGroups = new Set(orderedGroups.slice(0, groupsToRemove));
  return messages.filter((message) => !removedGroups.has(message.groupId));
}

export async function compactWithRecovery(input: {
  messages: CompactMessage[];
  summarize: (messages: CompactMessage[]) => Promise<CompactSummary>;
}) {
  const pruned = input.messages.filter((message) => message.content.trim().length > 0);
  try {
    return {
      level: 2 as const,
      messages: pruned,
      summary: await input.summarize(pruned),
    };
  } catch (error) {
    if (!isPromptTooLong(error)) throw error;
    const groupCount = new Set(pruned.map((message) => message.groupId)).size;
    const truncated = truncateOldestCompleteGroups(pruned, Math.max(1, Math.floor(groupCount / 2)));
    try {
      return {
        level: 3 as const,
        messages: truncated,
        summary: await input.summarize(truncated),
      };
    } catch (recoveryError) {
      if (!isPromptTooLong(recoveryError)) throw recoveryError;
      throw Object.assign(new Error("Context remains too long after bounded compaction recovery"), {
        code: "PROMPT_TOO_LONG",
        cause: recoveryError,
      });
    }
  }
}

function isPromptTooLong(error: unknown) {
  return typeof error === "object" && error !== null
    && "code" in error && error.code === "PROMPT_TOO_LONG";
}
