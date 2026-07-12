import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  interviewCoverage,
  interviewAgentRuns,
  interviewMessages,
  interviewQuestions,
  interviews,
  resumeVersions,
} from "@/lib/db/schema";
import { createStructuredInterviewAgentModelPort } from "./model-port";
import { createDrizzleInterviewAgentRepository } from "./repository";
import { runInterviewAgent } from "./runtime";
import { createInterviewToolRegistry } from "./tool-registry";
import type { AgentRunExecutor } from "./service";
import {
  indexResumeEvidence,
  loadResumeEvidence,
} from "./context/resume-evidence";
import { loadAgentContext } from "./context/assembler";
import { createProductionCompletionDependencies, scheduleInterviewCompletion } from "@/lib/interview/completion/composition";
import { effectiveContextBudget } from "./context/budget";
import { compactInterviewContextIfNeeded } from "./context/persisted-compaction";
import { resolveRunSkills } from "./skills";
import { ensureLatestAnswerAssessment } from "./assessment-service";

export function createProductionAgentDependencies(options?: { defer?: (task: () => Promise<void>) => void }) {
  const repository = createDrizzleInterviewAgentRepository(db);
  const completion = createProductionCompletionDependencies(options?.defer ?? ((task) => { void task(); }));
  const model = createStructuredInterviewAgentModelPort({
    async onUsage({ runId, usage }) {
      await db.update(interviewAgentRuns).set({
        inputTokens: sql`${interviewAgentRuns.inputTokens} + ${usage.inputTokens}`,
        outputTokens: sql`${interviewAgentRuns.outputTokens} + ${usage.outputTokens}`,
        ...(usage.cachedInputTokens === null ? {} : {
          cachedInputTokens: sql`${interviewAgentRuns.cachedInputTokens} + ${usage.cachedInputTokens}`,
        }),
        ...(usage.cacheWriteTokens === null ? {} : {
          cacheWriteTokens: sql`${interviewAgentRuns.cacheWriteTokens} + ${usage.cacheWriteTokens}`,
        }),
        ...(
          usage.cachedInputTokens === null && usage.cacheWriteTokens === null
            ? {}
            : { cacheMetricsAvailable: 1 }
        ),
        updatedAt: new Date(),
      }).where(eq(interviewAgentRuns.id, runId));
    },
  });
  const executor: AgentRunExecutor = {
    async run(input) {
      let phaseProgressId: string | undefined;
      let publicThinkingSummary: string | undefined;
      if (input.mode === "answer") {
        await repository.appendEvent(input.runId, {
          type: "thinking_started",
          payload: { runId: input.runId },
        });
        const assessment = await ensureLatestAnswerAssessment(db, {
          interviewId: input.interviewId,
          signal: input.signal,
        });
        phaseProgressId = assessment.id;
        publicThinkingSummary = assessment.value.publicSummary;
      }
      const contextWindow = readPositiveInteger(process.env.INTERVIEW_AGENT_CONTEXT_WINDOW, 128_000);
      const outputReserve = readPositiveInteger(process.env.INTERVIEW_AGENT_OUTPUT_RESERVE, 8_000);
      await compactInterviewContextIfNeeded(db, {
        interviewId: input.interviewId,
        effectiveBudget: effectiveContextBudget({ contextWindow, outputReserve }),
      });
      const promptContext = await loadAgentContext(db, {
        interviewId: input.interviewId,
        runId: input.runId,
        currentInstruction: input.instruction,
      });
      await db.update(interviewAgentRuns).set({
        promptTemplateVersion: promptContext.templateVersion,
        cacheEpoch: promptContext.cacheEpoch,
        contextInputTokens: promptContext.estimatedTokens,
        updatedAt: new Date(),
      }).where(eq(interviewAgentRuns.id, input.runId));
      let progressVersion = 0;
      const handlers = createToolHandlers(repository, completion, () => {
        progressVersion += 1;
      });
      const tools = createInterviewToolRegistry({
        handlers: handlers as Parameters<typeof createInterviewToolRegistry>[0]["handlers"],
        async validateEvidenceIds(evidenceIds, context) {
          const index = await loadInterviewEvidenceIndex(context.interviewId);
          return loadResumeEvidence(index, evidenceIds).missingIds;
        },
        async loadActionInput(toolInput) {
          const state = await repository.loadState(input.interviewId);
          return {
            ...state,
            proposal: {
              action: toolInput.action,
              category: toolInput.category,
              intent: toolInput.intent,
              question: toolInput.question,
              resumeEvidenceIds: toolInput.resumeEvidenceIds,
            },
          };
        },
      });
      const active = resolveRunSkills(input.mode);
      const deferredTools = new Map(
        [...tools].filter(([name]) => active.toolNames.has(name)),
      );
      return runInterviewAgent({
        interviewId: input.interviewId,
        runId: input.runId,
        repository,
        model,
        tools: deferredTools,
        activeSkills: active.skills,
        phaseProgressId,
        publicThinkingSummary,
        thinkingAlreadyStarted: input.mode === "answer",
        initialMessages: [{ role: "user", content: input.instruction }],
        signal: input.signal,
        progressHash: () => String(progressVersion),
        promptContext: {
          stablePrefix: promptContext.stablePrefix,
          incrementalTail: promptContext.incrementalTail,
        },
      });
    },
  };
  return { repository, executor };
}

function readPositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function createToolHandlers(
  repository: ReturnType<typeof createDrizzleInterviewAgentRepository>,
  completion: ReturnType<typeof createProductionCompletionDependencies>,
  markProgress: () => void,
) {
  return {
    async get_resume_evidence(input: { evidenceIds: string[] }, context: { interviewId: string }) {
      const index = await loadInterviewEvidenceIndex(context.interviewId);
      return {
        directory: index.directory,
        ...loadResumeEvidence(index, input.evidenceIds),
      };
    },
    async get_interview_history(input: { limit: number }, context: { interviewId: string }) {
      const messages = await db.select({ role: interviewMessages.role, kind: interviewMessages.kind, content: interviewMessages.content })
        .from(interviewMessages)
        .where(eq(interviewMessages.interviewId, context.interviewId))
        .orderBy(asc(interviewMessages.sequence));
      return messages.slice(-input.limit);
    },
    async get_coverage_state(_input: unknown, context: { interviewId: string }) {
      return db.select({
        category: interviewCoverage.category,
        topic: interviewCoverage.topic,
        questionCount: interviewCoverage.questionCount,
        status: interviewCoverage.status,
      }).from(interviewCoverage).where(eq(interviewCoverage.interviewId, context.interviewId));
    },
    async update_coverage(input: { category: string; topic: string; status: string; resumeEvidenceIds: string[] }, context: { interviewId: string }) {
      await db.insert(interviewCoverage).values({
        interviewId: context.interviewId,
        category: input.category,
        topic: input.topic,
        status: input.status,
        resumeEvidenceIds: input.resumeEvidenceIds,
      }).onConflictDoUpdate({
        target: [interviewCoverage.interviewId, interviewCoverage.category, interviewCoverage.topic],
        set: { status: input.status, resumeEvidenceIds: input.resumeEvidenceIds, updatedAt: new Date() },
      });
      markProgress();
      return { updated: true };
    },
    async ask_interview_question(input: { category: string; topic: string; question: string; resumeEvidenceIds: string[] }, context: { interviewId: string; runId: string; provisionalMessageId?: string }) {
      const question = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${context.interviewId}))`);
        const [indexRow] = await tx.select({ next: sql<number>`coalesce(max(${interviewQuestions.questionIndex}), 0) + 1` })
          .from(interviewQuestions)
          .where(eq(interviewQuestions.interviewId, context.interviewId));
        const [created] = await tx.insert(interviewQuestions).values({
          interviewId: context.interviewId,
          questionIndex: Number(indexRow.next),
          questionType: input.category,
          topic: input.topic,
          question: input.question,
          tip: "",
        }).returning({ id: interviewQuestions.id });
        await tx.update(interviewCoverage).set({
          questionCount: sql`${interviewCoverage.questionCount} + 1`,
          resumeEvidenceIds: input.resumeEvidenceIds,
          status: "partial",
          updatedAt: new Date(),
        }).where(and(
          eq(interviewCoverage.interviewId, context.interviewId),
          eq(interviewCoverage.category, input.category),
          eq(interviewCoverage.topic, "__category__"),
        ));
        return created;
      });
      const message = await repository.appendMessage({
        id: context.provisionalMessageId,
        interviewId: context.interviewId,
        runId: context.runId,
        role: "assistant",
        kind: "question",
        content: input.question,
      });
      markProgress();
      return {
        questionId: question.id,
        messageId: message.id,
        messageSequence: message.sequence,
        committed: true,
      };
    },
    async finish_interview(input: { closingMessage: string }, context: { interviewId: string; runId: string }) {
      await repository.appendMessage({
        interviewId: context.interviewId,
        runId: context.runId,
        role: "assistant",
        kind: "finish",
        content: input.closingMessage,
      });
      await db.update(interviews).set({ status: "scoring", updatedAt: new Date() })
        .where(and(eq(interviews.id, context.interviewId), eq(interviews.status, "active")));
      const job = await scheduleInterviewCompletion(completion, context.interviewId);
      markProgress();
      return { committed: true, completionJobId: job.id };
    },
  };
}

async function loadInterviewEvidenceIndex(interviewId: string) {
  const [row] = await db.select({
    parsedJson: resumeVersions.parsedJson,
    extractedText: resumeVersions.extractedText,
  }).from(interviews)
    .innerJoin(resumeVersions, eq(resumeVersions.id, interviews.resumeVersionId))
    .where(eq(interviews.id, interviewId))
    .limit(1);
  if (!row) throw new Error("Interview resume snapshot not found");
  return indexResumeEvidence(row.parsedJson, row.extractedText ?? "");
}
