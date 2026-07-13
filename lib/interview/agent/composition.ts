import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  interviewCoverage,
  interviewAgentRuns,
  interviewMessages,
  interviewResumeSnapshots,
  interviews,
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
import { createProductionCompletionDependencies } from "@/lib/interview/completion/composition";
import { effectiveContextBudget } from "./context/budget";
import { compactInterviewContextIfNeeded } from "./context/persisted-compaction";
import { resolveRunSkills } from "./skills";
import { agentRunFence } from "./fencing";
import type { InterviewToolHandlers } from "./tool-registry";

export function createProductionAgentDependencies(options?: { defer?: (task: () => Promise<void>) => void }) {
  const repository = createDrizzleInterviewAgentRepository(db);
  const completion = createProductionCompletionDependencies(options?.defer ?? ((task) => { void task(); }));
  const executor: AgentRunExecutor = {
    async run(input) {
      if (!input.lease) throw new Error("Agent run lease is required");
      const model = createStructuredInterviewAgentModelPort({
        async onUsage({ runId, usage }) {
          const updated = await db.update(interviewAgentRuns).set({
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
          }).where(agentRunFence(runId, input.lease)).returning({ id: interviewAgentRuns.id });
          if (updated.length === 0) throw new Error("Agent run lease is stale");
        },
      });
      const contextWindow = readPositiveInteger(process.env.INTERVIEW_AGENT_CONTEXT_WINDOW, 128_000);
      const outputReserve = readPositiveInteger(process.env.INTERVIEW_AGENT_OUTPUT_RESERVE, 8_000);
      await compactInterviewContextIfNeeded(db, {
        interviewId: input.interviewId,
        runId: input.runId,
        lease: input.lease,
        signal: input.signal,
        effectiveBudget: effectiveContextBudget({ contextWindow, outputReserve }),
      });
      const promptContext = await loadAgentContext(db, {
        interviewId: input.interviewId,
        runId: input.runId,
        currentInstruction: input.instruction,
        mode: input.mode,
      });
      const contextUpdated = await db.update(interviewAgentRuns).set({
        promptTemplateVersion: promptContext.templateVersion,
        cacheEpoch: promptContext.cacheEpoch,
        contextInputTokens: promptContext.estimatedTokens,
        updatedAt: new Date(),
      }).where(agentRunFence(input.runId, input.lease)).returning({ id: interviewAgentRuns.id });
      if (contextUpdated.length === 0) throw new Error("Agent run lease is stale");
      let progressVersion = 0;
      const handlers = createToolHandlers(repository, completion, () => {
        progressVersion += 1;
      });
      const tools = createInterviewToolRegistry({
        handlers,
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
        initialMessages: [{ role: "user", content: input.instruction }],
        signal: input.signal,
        lease: input.lease,
        progressHash: () => String(progressVersion),
        promptContext: {
          stablePrefix: promptContext.stablePrefix,
          incrementalTail: promptContext.incrementalTail,
        },
        turnContext: promptContext.turnContext,
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
): InterviewToolHandlers {
  return {
    async get_resume_evidence(input: { evidenceIds: string[] }, context: { interviewId: string }) {
      const index = await loadInterviewEvidenceIndex(context.interviewId);
      return {
        directory: index.directory,
        ...loadResumeEvidence(index, input.evidenceIds),
      };
    },
    async get_interview_history(input: { limit: number }, context: { interviewId: string }) {
      const messages = await db.select({ id: interviewMessages.id, role: interviewMessages.role, kind: interviewMessages.kind, content: interviewMessages.content })
        .from(interviewMessages)
        .where(eq(interviewMessages.interviewId, context.interviewId))
        .orderBy(asc(interviewMessages.sequence));
      return messages.slice(-input.limit).map((message) => ({
        ...message,
        sourceId: message.role === "user" ? `answer:${message.id}` : undefined,
      }));
    },
    async get_coverage_state(_input: unknown, context: { interviewId: string }) {
      return db.select({
        category: interviewCoverage.category,
        topic: interviewCoverage.topic,
        questionCount: interviewCoverage.questionCount,
        status: interviewCoverage.status,
      }).from(interviewCoverage).where(eq(interviewCoverage.interviewId, context.interviewId));
    },
    async submit_interview_turn(input, context) {
      const authorized = context.authorizedTerminal;
      if (!authorized) throw new Error("Authorized terminal context is required");
      const { responseText, ...proposal } = input;
      const outcome = await repository.commitTurnOutcome({
        interviewId: context.interviewId,
        runId: context.runId,
        toolCallId: authorized.toolCallId,
        lease: authorized.lease,
        logicalMessageId: authorized.logicalMessageId,
        attemptId: authorized.attemptId,
        answerMessageId: authorized.answerMessageId,
        proposal,
        proposalHash: authorized.proposalHash,
        responseText,
        language: authorized.language,
      });
      markProgress();
      if (outcome.message.kind === "finish") {
        try {
          const job = await completion.repository.getJobByInterview(context.interviewId);
          if (job) await completion.scheduler.schedule(job.id);
        } catch {}
      }
      return outcome;
    },
  };
}

async function loadInterviewEvidenceIndex(interviewId: string) {
  const [row] = await db.select({
    parsedJson: interviewResumeSnapshots.parsedJson,
    extractedText: interviewResumeSnapshots.extractedText,
  }).from(interviews)
    .innerJoin(interviewResumeSnapshots, eq(interviewResumeSnapshots.interviewId, interviews.id))
    .where(eq(interviews.id, interviewId))
    .limit(1);
  if (!row) throw new Error("Interview resume snapshot not found");
  return indexResumeEvidence(row.parsedJson, row.extractedText ?? "");
}
