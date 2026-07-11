import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { generateStructured } from "@/lib/ai/generate-structured";
import {
  interviewContextSnapshots,
  interviewCoverage,
  interviewMessages,
  interviews,
} from "@/lib/db/schema";
import { estimateTokens } from "./budget";
import { compactWithRecovery, shouldCompactContext, type CompactMessage } from "./compaction";

const compactSummarySchema = z.object({
  summary: z.string(),
  resumeEvidenceIds: z.array(z.string()),
  activeThreads: z.array(z.string()),
}).strict();

type AgentDatabase = typeof import("@/lib/db").db;

export async function compactInterviewContextIfNeeded(
  database: AgentDatabase,
  input: { interviewId: string; effectiveBudget: number },
) {
  const [interviewRows, snapshots, messageRows, coverage] = await Promise.all([
    database.select({
      candidateRoundCount: interviews.candidateRoundCount,
      compactionFailureCount: interviews.compactionFailureCount,
    }).from(interviews).where(eq(interviews.id, input.interviewId)).limit(1),
    database.select({
      cacheEpoch: interviewContextSnapshots.cacheEpoch,
      throughMessageSequence: interviewContextSnapshots.throughMessageSequence,
      summary: interviewContextSnapshots.summary,
      snapshotJson: interviewContextSnapshots.snapshotJson,
    }).from(interviewContextSnapshots)
      .where(eq(interviewContextSnapshots.interviewId, input.interviewId))
      .orderBy(desc(interviewContextSnapshots.cacheEpoch)).limit(1),
    database.select({
      sequence: interviewMessages.sequence,
      role: interviewMessages.role,
      kind: interviewMessages.kind,
      content: interviewMessages.content,
      metadata: interviewMessages.metadata,
    }).from(interviewMessages)
      .where(eq(interviewMessages.interviewId, input.interviewId))
      .orderBy(asc(interviewMessages.sequence)),
    database.select({
      category: interviewCoverage.category,
      topic: interviewCoverage.topic,
      questionCount: interviewCoverage.questionCount,
      status: interviewCoverage.status,
    }).from(interviewCoverage).where(eq(interviewCoverage.interviewId, input.interviewId)),
  ]);
  const interview = interviewRows[0];
  if (!interview) throw new Error("Interview context not found");
  const latest = snapshots[0];
  const previous = readSnapshotMetadata(latest?.snapshotJson);
  const uncompactedRows = messageRows.filter(
    (message) => message.sequence > (latest?.throughMessageSequence ?? 0),
  );
  const tokenEstimate = estimateTokens(JSON.stringify({
    checkpoint: latest?.summary ?? "",
    messages: uncompactedRows,
    coverage,
  }));
  if (!shouldCompactContext({
    candidateRoundCount: interview.candidateRoundCount,
    lastCompactedRound: previous.candidateRoundCount,
    tokenEstimate,
    effectiveBudget: input.effectiveBudget,
  })) return { compacted: false as const, cacheEpoch: latest?.cacheEpoch ?? 0 };

  const messages: CompactMessage[] = uncompactedRows.map((message) => ({
    groupId: readGroupId(message.metadata) ?? String(message.sequence),
    role: message.role,
    kind: message.kind,
    content: message.content,
  }));
  try {
    const result = await compactWithRecovery({
      messages,
      summarize: (items) => generateStructured({
        task: "context.compact",
        schema: compactSummarySchema,
        system: "你是面试上下文压缩器。保留事实、候选人回答证据、未解决追问和简历证据 ID，不得编造。",
        prompt: JSON.stringify({ previousSummary: latest?.summary ?? "", messages: items, coverage }),
      }),
    });
    const throughMessageSequence = messageRows.at(-1)?.sequence ?? 0;
    const cacheEpoch = (latest?.cacheEpoch ?? 0) + 1;
    await database.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${input.interviewId}))`);
      const existing = await tx.select({ cacheEpoch: interviewContextSnapshots.cacheEpoch })
        .from(interviewContextSnapshots)
        .where(and(
          eq(interviewContextSnapshots.interviewId, input.interviewId),
          eq(interviewContextSnapshots.cacheEpoch, cacheEpoch),
        )).limit(1);
      if (existing.length === 0) {
        await tx.insert(interviewContextSnapshots).values({
          interviewId: input.interviewId,
          cacheEpoch,
          throughMessageSequence,
          tokenEstimate,
          compactionLevel: result.level,
          summary: result.summary.summary,
          snapshotJson: {
            ...result.summary,
            candidateRoundCount: interview.candidateRoundCount,
          },
        });
      }
      await tx.update(interviews).set({ compactionFailureCount: 0, updatedAt: new Date() })
        .where(eq(interviews.id, input.interviewId));
    });
    return { compacted: true as const, cacheEpoch, level: result.level };
  } catch (error) {
    const failureCount = interview.compactionFailureCount + 1;
    await database.update(interviews).set({ compactionFailureCount: failureCount, updatedAt: new Date() })
      .where(eq(interviews.id, input.interviewId));
    if (failureCount >= 3) {
      throw Object.assign(new Error("Context compaction failed three consecutive times"), {
        code: "PROMPT_TOO_LONG",
        cause: error,
      });
    }
    return { compacted: false as const, cacheEpoch: latest?.cacheEpoch ?? 0, deferred: true as const };
  }
}

function readSnapshotMetadata(value: unknown) {
  if (!value || typeof value !== "object") return { candidateRoundCount: 0 };
  const count = (value as { candidateRoundCount?: unknown }).candidateRoundCount;
  return { candidateRoundCount: typeof count === "number" ? count : 0 };
}

function readGroupId(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const metadata = value as { groupId?: unknown; toolCallId?: unknown };
  const id = metadata.groupId ?? metadata.toolCallId;
  return typeof id === "string" ? id : null;
}
