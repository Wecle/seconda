import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import {
  interviewAnswerAssessments,
  interviewAgentEvents,
  interviewAgentRuns,
  interviewAgentToolCommits,
  interviewCompletionJobs,
  interviewCoverage,
  interviewMessages,
  interviewQuestions,
  interviews,
} from "@/lib/db/schema";
import { sanitizeAIError } from "@/lib/ai/error-sanitizer";
import type {
  AgentCheckpoint,
  AgentEventInput,
  AgentEventRecord,
  AgentEventVisibility,
  AgentExitReason,
  CoverageStatus,
  InterviewAgentState,
  InterviewMessageKind,
  QuestionCategory,
} from "./contracts";
import { agentExitMessage } from "./exit-messages";
import { questionCategorySchema, terminalRunPayloadSchema } from "./contracts";
import { authorizeTurnProposal, projectAssessmentCoverage } from "./turn-authorizer";
import {
  hashTurnProposalPrefix,
  interviewTurnProposalSchema,
  turnProposalPrefixSchema,
  type TurnProposalPrefix,
} from "./turn-proposal";

export const MAX_AGENT_RUN_RESUMES = 2;

export interface InterviewAgentRepository {
  createRun(input: {
    interviewId: string;
    idempotencyKey: string;
  }): Promise<{ id: string; status: "running"; created: boolean }>;
  appendEvent(
    runId: string,
    event: AgentEventInput,
    lease?: RunLeaseToken,
  ): Promise<{ sequence: number }>;
  getRun(runId: string): Promise<AgentRunRecord | null>;
  listEvents(
    runId: string,
    afterSequence: number,
    options?: { visibility?: AgentEventVisibility },
  ): Promise<AgentEventRecord[]>;
  claimRun(runId: string, owner: string, now: Date, leaseMs: number): Promise<{ claimed: boolean; run: AgentRunRecord | null }>;
  renewLease(runId: string, lease: RunLeaseToken, now: Date, leaseMs: number): Promise<boolean>;
  releaseLease(runId: string, lease: RunLeaseToken): Promise<boolean>;
  startAttempt(runId: string, input: {
    model: string;
    attemptId: string;
    attemptNumber: number;
    provisionalMessageId: string;
    now: Date;
  }, lease?: RunLeaseToken): Promise<void>;
  authorizeProposal(input: AuthorizeProposalInput): Promise<{
    authorized: true;
    proposalHash: string;
  }>;
  markResponseStarted(input: MarkResponseStartedInput): Promise<void>;
  commitTurnOutcome(input: CommitTurnOutcomeInput): Promise<CommittedTurnOutcome>;
  recordProviderProgress(runId: string, now: Date, lease?: RunLeaseToken): Promise<void>;
  saveRunTrigger(runId: string, trigger: AgentRunTrigger): Promise<void>;
  appendMessage(input: {
    id?: string;
    interviewId: string;
    runId: string;
    role: "user" | "assistant";
    kind: InterviewMessageKind;
    content: string;
    questionId?: string | null;
    idempotencyKey?: string;
  }): Promise<{ id: string; sequence: number }>;
  loadState(interviewId: string): Promise<InterviewAgentState>;
  saveCheckpoint(runId: string, checkpoint: AgentCheckpoint, lease?: RunLeaseToken): Promise<void>;
  terminateRun(runId: string, input: {
    exitReason: AgentExitReason;
    error?: unknown;
    retryable?: boolean;
    userMessage?: string;
  }, lease?: RunLeaseToken): Promise<{
    status: "completed" | "failed";
    eventSequence: number;
    created: boolean;
  }>;
  completeRun(runId: string, exitReason: AgentExitReason): Promise<void>;
  failRun(
    runId: string,
    exitReason: AgentExitReason,
    error: unknown,
  ): Promise<void>;
  commitQuestionOutcome(input: QuestionOutcomeInput): Promise<QuestionOutcome>;
  commitCoverageUpdate(input: CoverageUpdateInput): Promise<{ updated: true }>;
  commitFinishOutcome(input: FinishOutcomeInput): Promise<FinishOutcome>;
  markInterviewCompleting(interviewId: string): Promise<{ changed: boolean; invalidatedRunIds: string[] }>;
}

export type RunLeaseToken = {
  owner: string;
  generation: number;
};

export type AuthorizeProposalInput = {
  runId: string;
  lease: RunLeaseToken;
  attemptId: string;
  logicalMessageId: string;
  proposal: TurnProposalPrefix;
  proposalHash: string;
  checkpoint: AgentCheckpoint;
  authorizedAt?: Date;
};

export type MarkResponseStartedInput = {
  runId: string;
  lease: RunLeaseToken;
  attemptId: string;
  logicalMessageId: string;
  proposalHash: string;
  startedAt?: Date;
};

export type CommitTurnOutcomeInput = {
  runId: string;
  interviewId: string;
  toolCallId: string;
  lease: RunLeaseToken;
  logicalMessageId: string;
  attemptId: string;
  answerMessageId: string | null;
  proposal: TurnProposalPrefix;
  proposalHash: string;
  responseText: string;
  language: "zh" | "en" | "es" | "de";
};

export type CommittedTurnOutcome = {
  messageId: string;
  messageSequence: number;
  responseText: string;
  message: {
    id: string;
    runId: string;
    sequence: number;
    role: "assistant";
    kind: "question" | "finish" | "clarification";
    content: string;
  };
  committedEventSequence: number;
  committed: true;
};

export type QuestionOutcomeInput = {
  runId: string;
  interviewId: string;
  toolCallId: string;
  lease?: RunLeaseToken;
  category: string;
  topic: string;
  question: string;
  responseText: string;
  resumeEvidenceIds: string[];
  provisionalMessageId?: string;
  targetRole?: {
    value: string;
    status: "inferred" | "confirmed";
    confidence: "low" | "medium" | "high";
    sourceIds: string[];
  };
};

export type QuestionOutcome = {
  questionId: string;
  messageId: string;
  messageSequence: number;
  responseText: string;
  committed: true;
};

export type CoverageUpdateInput = {
  runId: string;
  interviewId: string;
  toolCallId: string;
  lease?: RunLeaseToken;
  category: string;
  topic: string;
  status: string;
  resumeEvidenceIds: string[];
};

export type FinishOutcomeInput = {
  runId: string;
  interviewId: string;
  toolCallId: string;
  lease?: RunLeaseToken;
  closingMessage: string;
};

export type FinishOutcome = {
  messageId: string;
  messageSequence: number;
  responseText: string;
  committed: true;
};

export type AgentRunRecord = {
  id: string;
  interviewId: string;
  status: "running" | "completed" | "failed";
  phase?: AgentRunPhase;
  attemptId: string | null;
  attemptNumber?: number;
  provisionalMessageId: string | null;
  exitReason: AgentExitReason | null;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  leaseGeneration: number;
  resumeCount: number;
  nextResumeAt: Date | null;
  checkpoint: AgentCheckpoint | null;
  trigger: AgentRunTrigger | null;
  lastEventSequence: number;
};

export type AgentRunPhase =
  | "accepted"
  | "reasoning"
  | "tool_running"
  | "proposal_streaming"
  | "authorized"
  | "responding"
  | "validating"
  | "committing"
  | "repairing"
  | "acting"
  | "scoring"
  | "reporting";

export type AgentRunTrigger = {
  mode: "opening" | "answer";
  instruction: string;
};

type MemoryRun = {
  id: string;
  interviewId: string;
  idempotencyKey: string;
  status: "running" | "completed" | "failed";
  phase: AgentRunPhase;
  eventSequence: number;
  checkpoint?: AgentCheckpoint;
  exitReason: AgentExitReason | null;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  leaseGeneration: number;
  resumeCount: number;
  nextResumeAt: Date | null;
  events: AgentEventRecord[];
  eventDedupeSequences: Map<string, number>;
  model: string | null;
  attemptId: string | null;
  attemptNumber: number;
  provisionalMessageId: string | null;
  lastProviderProgressAt: Date | null;
  trigger: AgentRunTrigger | null;
  authorizedProposal: TurnProposalPrefix | null;
  authorizedProposalHash: string | null;
  proposalAuthorizedAt: Date | null;
  responseStartedAt: Date | null;
};

export function createInMemoryInterviewAgentRepository(
  initialState?: InterviewAgentState,
  authoritativeLanguage: CommitTurnOutcomeInput["language"] = "zh",
) {
  let id = 0;
  const runs = new Map<string, MemoryRun>();
  const runKeys = new Map<string, string>();
  const messageKeys = new Map<string, { id: string; sequence: number }>();
  const messageSequences = new Map<string, number>();
  const interviewQuestionsById = new Map<string, Array<{ id: string; category: string; topic: string; question: string }>>();
  const interviewMessagesById = new Map<string, Array<{
    id: string;
    runId: string;
    questionId: string | null;
    role: "user" | "assistant";
    kind: InterviewMessageKind;
    content: string;
    sequence: number;
  }>>();
  const assessmentsByInterview = new Map<string, Array<{
    id: string;
    answerMessageId: string;
    questionId: string;
    assessment: NonNullable<TurnProposalPrefix["assessment"]>;
  }>>();
  const coverageByInterview = new Map<string, Array<{
    category: string;
    topic: string;
    status: string;
    resumeEvidenceIds: string[];
    questionCount: number;
    depth: number;
    evidenceQuality: number;
    lastAssessmentId: string | null;
  }>>();
  const categoryCountsByInterview = new Map<string, Record<string, number>>();
  const targetRoleByInterview = new Map<string, QuestionOutcomeInput["targetRole"]>();
  const toolCommits = new Map<string, { toolName: string; result: unknown }>();
  const completingInterviews = new Set<string>();
  const states = new Map<string, InterviewAgentState>();

  if (initialState) {
    states.set(initialState.interviewId, initialState);
    categoryCountsByInterview.set(
      initialState.interviewId,
      Object.fromEntries(Object.entries(initialState.categoryCounts).map(
        ([category, count]) => [category, count ?? 0],
      )),
    );
  }

  const repository: InterviewAgentRepository & {
    inspectRun(runId: string): MemoryRun | undefined;
    inspectInterview(interviewId: string): {
      status: "active" | "completing";
      questions: Array<{ id: string; category: string; topic: string; question: string }>;
      messages: Array<{
        id: string;
        runId: string;
        questionId: string | null;
        role: "user" | "assistant";
        kind: InterviewMessageKind;
        content: string;
        sequence: number;
      }>;
      categoryCounts: Record<string, number>;
      targetRole: QuestionOutcomeInput["targetRole"];
      assessments: Array<{
        id: string;
        answerMessageId: string;
        questionId: string;
        assessment: NonNullable<TurnProposalPrefix["assessment"]>;
      }>;
      coverage: Array<{
        category: string;
        topic: string;
        status: string;
        resumeEvidenceIds: string[];
        questionCount: number;
        depth: number;
        evidenceQuality: number;
        lastAssessmentId: string | null;
      }>;
      messageCommittedEvents: AgentEventRecord[];
      submitTurnCommits: CommittedTurnOutcome[];
    };
  } = {
    async createRun(input) {
      const key = `${input.interviewId}:${input.idempotencyKey}`;
      const existingId = runKeys.get(key);
      if (existingId) return { id: existingId, status: "running", created: false };
      const run: MemoryRun = {
        id: `run-${++id}`,
        interviewId: input.interviewId,
        idempotencyKey: input.idempotencyKey,
        status: "running",
        phase: "accepted",
        eventSequence: 0,
        exitReason: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        leaseGeneration: 0,
        resumeCount: 0,
        nextResumeAt: null,
        events: [],
        eventDedupeSequences: new Map(),
        model: null,
        attemptId: null,
        attemptNumber: 0,
        provisionalMessageId: null,
        lastProviderProgressAt: null,
        trigger: null,
        authorizedProposal: null,
        authorizedProposalHash: null,
        proposalAuthorizedAt: null,
        responseStartedAt: null,
      };
      runs.set(run.id, run);
      runKeys.set(key, run.id);
      return { id: run.id, status: "running", created: true };
    },
    async appendEvent(runId, event, lease) {
      const run = requireMemoryRun(runs, runId);
      assertMemoryFence(run, lease);
      if (event.dedupeKey) {
        const existingSequence = run.eventDedupeSequences.get(event.dedupeKey);
        if (existingSequence) return { sequence: existingSequence };
      }
      run.eventSequence += 1;
      run.events.push({
        id: `event-${++id}`,
        runId,
        sequence: run.eventSequence,
        type: event.type,
        visibility: event.visibility ?? "internal",
        attemptId: event.attemptId ?? null,
        logicalMessageId: event.logicalMessageId ?? null,
        payload: event.payload,
        createdAt: new Date().toISOString(),
      });
      if (event.dedupeKey) run.eventDedupeSequences.set(event.dedupeKey, run.eventSequence);
      return { sequence: run.eventSequence };
    },
    async getRun(runId) {
      const run = runs.get(runId);
      return run ? memoryRunRecord(run) : null;
    },
    async listEvents(runId, afterSequence, options) {
      return requireMemoryRun(runs, runId).events.filter((event) => (
        event.sequence > afterSequence
        && (!options?.visibility || event.visibility === options.visibility)
      ));
    },
    async claimRun(runId, owner, now, leaseMs) {
      const run = requireMemoryRun(runs, runId);
      const recovering = isRecoverableFailedRun(run);
      if (run.status !== "running" && !recovering) return { claimed: false, run: memoryRunRecord(run) };
      const expired = !run.leaseExpiresAt || run.leaseExpiresAt.getTime() <= now.getTime();
      if (!recovering && !expired) return { claimed: false, run: memoryRunRecord(run) };
      const retrying = recovering || Boolean(run.leaseOwner && expired);
      if (retrying && run.resumeCount >= MAX_AGENT_RUN_RESUMES) {
        return { claimed: false, run: memoryRunRecord(run) };
      }
      if (recovering && run.nextResumeAt && run.nextResumeAt.getTime() > now.getTime()) {
        return { claimed: false, run: memoryRunRecord(run) };
      }
      if (retrying) run.resumeCount += 1;
      run.leaseGeneration += 1;
      if (recovering) {
        run.status = "running";
        run.exitReason = null;
        run.nextResumeAt = null;
      }
      run.leaseOwner = owner;
      run.leaseExpiresAt = new Date(now.getTime() + leaseMs);
      return { claimed: true, run: memoryRunRecord(run) };
    },
    async renewLease(runId, lease, now, leaseMs) {
      const run = requireMemoryRun(runs, runId);
      if (run.status !== "running" || run.leaseOwner !== lease.owner || run.leaseGeneration !== lease.generation || !run.leaseExpiresAt || run.leaseExpiresAt <= now) return false;
      run.leaseExpiresAt = new Date(now.getTime() + leaseMs);
      return true;
    },
    async releaseLease(runId, lease) {
      const run = requireMemoryRun(runs, runId);
      if (run.leaseOwner !== lease.owner || run.leaseGeneration !== lease.generation) return false;
      run.leaseOwner = null;
      run.leaseExpiresAt = null;
      return true;
    },
    async startAttempt(runId, input, lease) {
      const run = requireRunningMemoryRun(runs, runId);
      assertMemoryFence(run, lease);
      if (input.attemptNumber <= run.attemptNumber) {
        if (
          input.attemptNumber === run.attemptNumber
          && input.attemptId === run.attemptId
          && input.provisionalMessageId === run.provisionalMessageId
        ) return;
        throw new Error("Agent attempt is stale");
      }
      run.model = input.model;
      run.attemptId = input.attemptId;
      run.attemptNumber = input.attemptNumber;
      run.provisionalMessageId = input.provisionalMessageId;
      run.lastProviderProgressAt = input.now;
      run.phase = "reasoning";
      run.authorizedProposal = null;
      run.authorizedProposalHash = null;
      run.proposalAuthorizedAt = null;
      run.responseStartedAt = null;
    },
    async authorizeProposal(input) {
      const run = requireRunningMemoryRun(runs, input.runId);
      assertMemoryAttemptFence(run, input);
      if (![
        "reasoning",
        "tool_running",
        "proposal_streaming",
        "repairing",
      ].includes(run.phase)) {
        throw new Error("Agent proposal authorization phase is stale");
      }
      const proposal = parseAuthorizedProposal(input.proposal, input.proposalHash);
      run.phase = "authorized";
      run.authorizedProposal = proposal;
      run.authorizedProposalHash = input.proposalHash;
      run.proposalAuthorizedAt = input.authorizedAt ?? new Date();
      run.checkpoint = input.checkpoint;
      return { authorized: true, proposalHash: input.proposalHash };
    },
    async markResponseStarted(input) {
      const run = requireRunningMemoryRun(runs, input.runId);
      assertMemoryAttemptFence(run, input);
      if (
        run.phase !== "authorized"
        || run.authorizedProposalHash !== input.proposalHash
      ) {
        throw new Error("Agent proposal hash is stale");
      }
      run.phase = "responding";
      run.responseStartedAt = input.startedAt ?? new Date();
    },
    async recordProviderProgress(runId, now, lease) {
      const run = requireRunningMemoryRun(runs, runId);
      assertMemoryFence(run, lease);
      run.lastProviderProgressAt = now;
    },
    async saveRunTrigger(runId, trigger) {
      requireRunningMemoryRun(runs, runId).trigger = trigger;
    },
    async appendMessage(input) {
      const key = input.idempotencyKey
        ? `${input.interviewId}:${input.idempotencyKey}`
        : null;
      const existing = key ? messageKeys.get(key) : undefined;
      if (existing) return existing;
      const sequence = (messageSequences.get(input.interviewId) ?? 0) + 1;
      messageSequences.set(input.interviewId, sequence);
      const result = { id: input.id ?? `message-${++id}`, sequence };
      if (key) messageKeys.set(key, result);
      interviewMessagesById.set(input.interviewId, [
        ...(interviewMessagesById.get(input.interviewId) ?? []),
        {
          ...result,
          runId: input.runId,
          questionId: input.questionId ?? null,
          role: input.role,
          kind: input.kind,
          content: input.content,
        },
      ]);
      return result;
    },
    async loadState(interviewId) {
      return buildMemoryPolicyState({
        interviewId,
        states,
        categoryCountsByInterview,
        interviewQuestionsById,
        assessmentsByInterview,
        coverageByInterview,
        completingInterviews,
      });
    },
    async saveCheckpoint(runId, checkpoint, lease) {
      const run = requireMemoryRun(runs, runId);
      assertMemoryFence(run, lease);
      run.checkpoint = checkpoint;
      if (checkpoint.phase) run.phase = checkpoint.phase;
    },
    async terminateRun(runId, input, lease) {
      const run = requireMemoryRun(runs, runId);
      assertMemoryFence(run, lease);
      if (run.status !== "running") {
        return { status: run.status, eventSequence: run.eventSequence, created: false };
      }
      const completed = input.exitReason === "completed";
      for (const event of run.events) {
        if (
          event.visibility === "public"
          && (event.type === "run_completed" || event.type === "run_failed")
        ) {
          event.visibility = "internal";
        }
      }
      run.eventSequence += 1;
      run.events.push({
        id: `event-${++id}`,
        runId,
        sequence: run.eventSequence,
        type: completed ? "run_completed" : "run_failed",
        visibility: "public",
        attemptId: null,
        logicalMessageId: null,
        payload: buildTerminalPayload(runId, input),
        createdAt: new Date().toISOString(),
      });
      run.status = completed ? "completed" : "failed";
      run.exitReason = input.exitReason;
      run.nextResumeAt = !completed && RECOVERABLE_RUN_EXIT_REASONS.includes(input.exitReason)
        && run.resumeCount < MAX_AGENT_RUN_RESUMES
        ? new Date(Date.now() + Math.min(300_000, 30_000 * (2 ** run.resumeCount)))
        : null;
      run.leaseOwner = null;
      run.leaseExpiresAt = null;
      return { status: run.status, eventSequence: run.eventSequence, created: true };
    },
    async completeRun(runId) {
      const result = await this.terminateRun(runId, { exitReason: "completed" });
      if (!result.created) throw new Error(`Run ${runId} is already terminal`);
    },
    async failRun(runId, exitReason, error) {
      const result = await this.terminateRun(runId, { exitReason, error });
      if (!result.created) throw new Error(`Run ${runId} is already terminal`);
    },
    async commitTurnOutcome(input) {
      const run = requireRunningMemoryRun(runs, input.runId);
      assertMemoryAttemptFence(run, input);
      if (run.interviewId !== input.interviewId) {
        throw new Error("Agent run does not belong to interview");
      }
      const key = `${input.runId}:${input.toolCallId}`;
      const existing = toolCommits.get(key);
      if (existing) {
        if (existing.toolName !== "submit_interview_turn") {
          throw new Error("Agent tool call id is already committed by another tool");
        }
        return existing.result as CommittedTurnOutcome;
      }
      if (
        run.phase !== "committing"
        || run.authorizedProposalHash !== input.proposalHash
        || !run.responseStartedAt
      ) {
        throw new Error("Agent proposal hash is stale or response has not started");
      }
      if (input.language !== authoritativeLanguage) {
        throw new Error("Interview language does not match authoritative configuration");
      }
      const terminalProposal = interviewTurnProposalSchema.parse({
        ...input.proposal,
        responseText: input.responseText,
      });
      const { responseText, ...proposalInput } = terminalProposal;
      const proposal = parseAuthorizedProposal(proposalInput, input.proposalHash);
      if (hashTurnProposalPrefix(run.authorizedProposal!) !== input.proposalHash) {
        throw new Error("Agent proposal hash is stale");
      }
      if (proposal.coverageChanges.some((change) => change.topic === "__category__")) {
        throw new Error("Reserved coverage topic cannot be proposed");
      }

      const messages = interviewMessagesById.get(input.interviewId) ?? [];
      const questions = interviewQuestionsById.get(input.interviewId) ?? [];
      const answerMessage = input.answerMessageId
        ? messages.find((message) => message.id === input.answerMessageId)
        : null;
      const answerQuestion = answerMessage?.questionId
        ? questions.find((question) => question.id === answerMessage.questionId)
        : null;
      if (input.answerMessageId && (
        !answerMessage
        || answerMessage.runId !== input.runId
        || answerMessage.role !== "user"
        || answerMessage.kind !== "answer"
        || !answerQuestion
      )) {
        throw new Error("Answer message does not belong to this interview question");
      }

      const mode = input.answerMessageId ? "answer" as const : "opening" as const;
      const answerCategory = answerQuestion
        ? questionCategorySchema.parse(answerQuestion.category)
        : null;
      const state = buildMemoryPolicyState({
        interviewId: input.interviewId,
        states,
        categoryCountsByInterview,
        interviewQuestionsById,
        assessmentsByInterview,
        coverageByInterview,
        completingInterviews,
      });
      const authorization = authorizeTurnProposal({
        state,
        mode,
        answerCategory,
        prefix: proposal,
        responseText,
      });
      if (!authorization.allowed) {
        throw new Error(`Turn proposal rejected: ${authorization.reason}`);
      }

      const now = new Date();
      const assessmentId = proposal.assessment ? `assessment-${++id}` : null;
      const nextQuestions = [...questions];
      const nextMessages = [...messages];
      const nextAssessments = [
        ...(assessmentsByInterview.get(input.interviewId) ?? []),
      ];
      const nextCoverage = [
        ...(coverageByInterview.get(input.interviewId) ?? []),
      ].map((item) => ({ ...item, resumeEvidenceIds: [...item.resumeEvidenceIds] }));
      const nextCounts = {
        ...(categoryCountsByInterview.get(input.interviewId) ?? {}),
      };

      if (proposal.assessment && answerMessage && answerQuestion && assessmentId) {
        if (nextAssessments.some((item) => item.answerMessageId === answerMessage.id)) {
          throw new Error("Answer assessment already committed");
        }
        nextAssessments.push({
          id: assessmentId,
          answerMessageId: answerMessage.id,
          questionId: answerQuestion.id,
          assessment: proposal.assessment,
        });
        applyMemoryAssessmentCoverage(nextCoverage, {
          interviewId: input.interviewId,
          category: answerCategory!,
          questionCount: nextCounts[answerCategory!] ?? 0,
          assessmentId,
          assessment: proposal.assessment,
        });
      }

      for (const change of authorization.prefix.coverageChanges) {
        upsertMemoryCoverage(nextCoverage, {
          category: change.category,
          topic: change.topic,
          status: change.status,
          resumeEvidenceIds: change.resumeEvidenceIds,
          questionCount: 0,
          depth: 0,
          evidenceQuality: 0,
          lastAssessmentId: null,
        });
      }

      let questionId: string | null = null;
      let kind: CommittedTurnOutcome["message"]["kind"];
      if (proposal.decision.action === "finish") {
        kind = "finish";
      } else {
        kind = proposal.decision.action === "clarify" ? "clarification" : "question";
        const category = proposal.decision.category;
        if ((nextCounts[category] ?? 0) >= 3) throw new Error("CATEGORY_LIMIT_REACHED");
        questionId = `question-${++id}`;
        nextQuestions.push({
          id: questionId,
          category,
          topic: proposal.decision.coverageTarget,
          question: responseText,
        });
        nextCounts[category] = (nextCounts[category] ?? 0) + 1;
        incrementMemoryCategoryCoverage(nextCoverage, category, nextCounts[category], proposal.decision.evidenceIds);
      }

      const messageSequence = (messageSequences.get(input.interviewId) ?? 0) + 1;
      const message: CommittedTurnOutcome["message"] = {
        id: input.logicalMessageId,
        runId: input.runId,
        sequence: messageSequence,
        role: "assistant",
        kind,
        content: responseText,
      };
      nextMessages.push({
        ...message,
        questionId,
      });

      run.eventSequence += 1;
      const event: AgentEventRecord = {
        id: `event-${++id}`,
        runId: input.runId,
        sequence: run.eventSequence,
        type: "message_committed",
        visibility: "public",
        attemptId: input.attemptId,
        logicalMessageId: input.logicalMessageId,
        payload: {
          runId: input.runId,
          attemptId: input.attemptId,
          logicalMessageId: input.logicalMessageId,
          message,
        },
        createdAt: now.toISOString(),
      };
      const outcome: CommittedTurnOutcome = {
        messageId: message.id,
        messageSequence,
        responseText,
        message,
        committedEventSequence: event.sequence,
        committed: true,
      };

      interviewQuestionsById.set(input.interviewId, nextQuestions);
      interviewMessagesById.set(input.interviewId, nextMessages);
      assessmentsByInterview.set(input.interviewId, nextAssessments);
      coverageByInterview.set(input.interviewId, nextCoverage);
      categoryCountsByInterview.set(input.interviewId, nextCounts);
      messageSequences.set(input.interviewId, messageSequence);
      run.events.push(event);
      run.phase = "acting";
      if (proposal.decision.action === "finish") completingInterviews.add(input.interviewId);
      toolCommits.set(key, { toolName: "submit_interview_turn", result: outcome });
      return outcome;
    },
    async commitQuestionOutcome(input) {
      const run = requireRunningMemoryRun(runs, input.runId);
      assertMemoryFence(run, input.lease);
      const key = `${input.runId}:${input.toolCallId}`;
      const existing = toolCommits.get(key);
      if (existing) return existing.result as QuestionOutcome;
      const counts = categoryCountsByInterview.get(input.interviewId) ?? {};
      if ((counts[input.category] ?? 0) >= 3) throw new Error("CATEGORY_LIMIT_REACHED");
      const questionId = `question-${++id}`;
      const messageId = input.provisionalMessageId ?? `message-${++id}`;
      const sequence = (messageSequences.get(input.interviewId) ?? 0) + 1;
      const outcome: QuestionOutcome = {
        questionId,
        messageId,
        messageSequence: sequence,
        responseText: input.responseText,
        committed: true,
      };
      interviewQuestionsById.set(input.interviewId, [
        ...(interviewQuestionsById.get(input.interviewId) ?? []),
        { id: questionId, category: input.category, topic: input.topic, question: input.question },
      ]);
      interviewMessagesById.set(input.interviewId, [
        ...(interviewMessagesById.get(input.interviewId) ?? []),
        {
          id: messageId,
          runId: input.runId,
          questionId,
          role: "assistant",
          kind: "question",
          content: input.responseText,
          sequence,
        },
      ]);
      messageSequences.set(input.interviewId, sequence);
      categoryCountsByInterview.set(input.interviewId, { ...counts, [input.category]: (counts[input.category] ?? 0) + 1 });
      if (input.targetRole) targetRoleByInterview.set(input.interviewId, input.targetRole);
      toolCommits.set(key, { toolName: "ask_interview_question", result: outcome });
      return outcome;
    },
    async commitCoverageUpdate(input) {
      const run = requireRunningMemoryRun(runs, input.runId);
      assertMemoryFence(run, input.lease);
      const key = `${input.runId}:${input.toolCallId}`;
      const existing = toolCommits.get(key);
      if (existing) return existing.result as { updated: true };
      const result = { updated: true as const };
      toolCommits.set(key, { toolName: "update_coverage", result });
      return result;
    },
    async commitFinishOutcome(input) {
      const run = requireRunningMemoryRun(runs, input.runId);
      assertMemoryFence(run, input.lease);
      const key = `${input.runId}:${input.toolCallId}`;
      const existing = toolCommits.get(key);
      if (existing) return existing.result as FinishOutcome;
      const sequence = (messageSequences.get(input.interviewId) ?? 0) + 1;
      const outcome: FinishOutcome = {
        messageId: `message-${++id}`,
        messageSequence: sequence,
        responseText: input.closingMessage,
        committed: true,
      };
      interviewMessagesById.set(input.interviewId, [
        ...(interviewMessagesById.get(input.interviewId) ?? []),
        {
          id: outcome.messageId,
          runId: input.runId,
          questionId: null,
          role: "assistant",
          kind: "finish",
          content: input.closingMessage,
          sequence,
        },
      ]);
      messageSequences.set(input.interviewId, sequence);
      completingInterviews.add(input.interviewId);
      toolCommits.set(key, { toolName: "finish_interview", result: outcome });
      return outcome;
    },
    async markInterviewCompleting(interviewId) {
      if (completingInterviews.has(interviewId)) {
        return { changed: false, invalidatedRunIds: [] };
      }
      completingInterviews.add(interviewId);
      const invalidatedRunIds: string[] = [];
      for (const run of runs.values()) {
        if (run.interviewId !== interviewId || run.status !== "running") continue;
        await repository.terminateRun(run.id, {
          exitReason: "aborted_tools",
          error: new Error("Interview ended by user"),
          userMessage: "用户已结束面试。",
        });
        run.leaseGeneration += 1;
        invalidatedRunIds.push(run.id);
      }
      return { changed: true, invalidatedRunIds };
    },
    inspectRun(runId) {
      return runs.get(runId);
    },
    inspectInterview(interviewId: string) {
      const runsForInterview = [...runs.values()].filter((run) => run.interviewId === interviewId);
      return {
        status: completingInterviews.has(interviewId) ? "completing" : "active",
        questions: interviewQuestionsById.get(interviewId) ?? [],
        messages: interviewMessagesById.get(interviewId) ?? [],
        categoryCounts: categoryCountsByInterview.get(interviewId) ?? {},
        targetRole: targetRoleByInterview.get(interviewId),
        assessments: assessmentsByInterview.get(interviewId) ?? [],
        coverage: coverageByInterview.get(interviewId) ?? [],
        messageCommittedEvents: runsForInterview.flatMap((run) => (
          run.events.filter((event) => event.type === "message_committed")
        )),
        submitTurnCommits: [...toolCommits.values()]
          .filter((commit) => commit.toolName === "submit_interview_turn")
          .map((commit) => commit.result as CommittedTurnOutcome),
      };
    },
  };
  return repository;
}

function memoryRunRecord(run: MemoryRun): AgentRunRecord {
  return {
    id: run.id,
    interviewId: run.interviewId,
    status: run.status,
    phase: run.phase,
    attemptId: run.attemptId,
    attemptNumber: run.attemptNumber,
    provisionalMessageId: run.provisionalMessageId,
    exitReason: run.exitReason,
    leaseOwner: run.leaseOwner,
    leaseExpiresAt: run.leaseExpiresAt,
    leaseGeneration: run.leaseGeneration,
    resumeCount: run.resumeCount,
    nextResumeAt: run.nextResumeAt,
    checkpoint: run.checkpoint ?? null,
    trigger: run.trigger,
    lastEventSequence: run.eventSequence,
  };
}

function assertMemoryFence(run: MemoryRun, lease?: RunLeaseToken) {
  if (!lease) return;
  if (
    run.status !== "running" ||
    run.leaseOwner !== lease.owner ||
    run.leaseGeneration !== lease.generation
  ) {
    throw new Error("Agent run lease is stale");
  }
}

function assertMemoryAttemptFence(
  run: MemoryRun,
  input: {
    lease: RunLeaseToken;
    attemptId: string;
    logicalMessageId: string;
  },
) {
  assertMemoryFence(run, input.lease);
  if (
    run.attemptId !== input.attemptId
    || run.provisionalMessageId !== input.logicalMessageId
  ) {
    throw new Error("Agent attempt is stale");
  }
}

function parseAuthorizedProposal(
  proposal: TurnProposalPrefix,
  proposalHash: string,
): TurnProposalPrefix {
  const normalized = turnProposalPrefixSchema.parse(proposal);
  if (hashTurnProposalPrefix(normalized) !== proposalHash) {
    throw new Error("Agent proposal hash is stale");
  }
  if (normalized.coverageChanges.some((change) => change.topic === "__category__")) {
    throw new Error("Reserved coverage topic cannot be proposed");
  }
  return normalized;
}

function buildMemoryPolicyState(input: {
  interviewId: string;
  states: Map<string, InterviewAgentState>;
  categoryCountsByInterview: Map<string, Record<string, number>>;
  interviewQuestionsById: Map<string, Array<{
    id: string;
    category: string;
    topic: string;
    question: string;
  }>>;
  assessmentsByInterview: Map<string, Array<{
    assessment: NonNullable<TurnProposalPrefix["assessment"]>;
  }>>;
  coverageByInterview: Map<string, Array<{
    category: string;
    topic: string;
    status: string;
  }>>;
  completingInterviews: Set<string>;
}): InterviewAgentState {
  const base = input.states.get(input.interviewId);
  const counts = input.categoryCountsByInterview.get(input.interviewId) ?? {};
  const aggregateCoverage = coverageStatusesForMemoryInterview(input.interviewId);
  let consecutiveNoFollowUpAssessments =
    base?.consecutiveNoFollowUpAssessments ?? 0;
  for (const item of input.assessmentsByInterview.get(input.interviewId) ?? []) {
    consecutiveNoFollowUpAssessments = item.assessment.followUpNeeded
      ? 0
      : consecutiveNoFollowUpAssessments + 1;
  }
  return {
    interviewId: input.interviewId,
    candidateRoundCount: base?.candidateRoundCount ?? 0,
    categoryCounts: counts,
    categoryStatuses: {
      ...(base?.categoryStatuses ?? {}),
      ...aggregateCoverage,
    },
    consecutiveNoFollowUpAssessments,
    recentQuestions: [
      ...(base?.recentQuestions ?? []),
      ...(input.interviewQuestionsById.get(input.interviewId) ?? []).map(
        (question) => question.question,
      ),
    ].slice(-10),
    requestedUserEnd: input.completingInterviews.has(input.interviewId)
      || (base?.requestedUserEnd ?? false),
  };

  function coverageStatusesForMemoryInterview(interviewId: string) {
    const coverage = input.coverageByInterview.get(interviewId) ?? [];
    return Object.fromEntries(
      coverage
        .filter((item) => item.topic === "__category__")
        .map((item) => [item.category, item.status]),
    ) as Partial<Record<QuestionCategory, CoverageStatus>>;
  }
}

function upsertMemoryCoverage(
  coverage: Array<{
    category: string;
    topic: string;
    status: string;
    resumeEvidenceIds: string[];
    questionCount: number;
    depth: number;
    evidenceQuality: number;
    lastAssessmentId: string | null;
  }>,
  value: (typeof coverage)[number],
) {
  const index = coverage.findIndex((item) => (
    item.category === value.category && item.topic === value.topic
  ));
  if (index === -1) coverage.push({ ...value, resumeEvidenceIds: [...value.resumeEvidenceIds] });
  else coverage[index] = { ...value, resumeEvidenceIds: [...value.resumeEvidenceIds] };
}

function applyMemoryAssessmentCoverage(
  coverage: Parameters<typeof upsertMemoryCoverage>[0],
  input: {
    interviewId: string;
    category: QuestionCategory;
    questionCount: number;
    assessmentId: string;
    assessment: NonNullable<TurnProposalPrefix["assessment"]>;
  },
) {
  const projected = projectAssessmentCoverage(input.assessment);
  upsertMemoryCoverage(coverage, {
    category: input.category,
    topic: "__category__",
    status: input.questionCount >= 3 ? "exhausted" : projected.status,
    resumeEvidenceIds: [],
    questionCount: input.questionCount,
    depth: projected.depth,
    evidenceQuality: projected.evidenceQuality,
    lastAssessmentId: input.assessmentId,
  });
}

function incrementMemoryCategoryCoverage(
  coverage: Parameters<typeof upsertMemoryCoverage>[0],
  category: QuestionCategory,
  questionCount: number,
  resumeEvidenceIds: string[],
) {
  const existing = coverage.find((item) => (
    item.category === category && item.topic === "__category__"
  ));
  upsertMemoryCoverage(coverage, {
    category,
    topic: "__category__",
    status: questionCount >= 3 ? "exhausted" : "partial",
    resumeEvidenceIds,
    questionCount,
    depth: existing?.depth ?? 0,
    evidenceQuality: existing?.evidenceQuality ?? 0,
    lastAssessmentId: existing?.lastAssessmentId ?? null,
  });
}

const RECOVERABLE_RUN_EXIT_REASONS: AgentExitReason[] = [
  "aborted_streaming",
  "provider_failed",
  "prompt_too_long",
];

function isRecoverableFailedRun(run: Pick<MemoryRun, "status" | "exitReason" | "trigger">) {
  return run.status === "failed"
    && run.trigger !== null
    && run.exitReason !== null
    && RECOVERABLE_RUN_EXIT_REASONS.includes(run.exitReason);
}

function requireMemoryRun(runs: Map<string, MemoryRun>, runId: string) {
  const run = runs.get(runId);
  if (!run) throw new Error(`Unknown run: ${runId}`);
  return run;
}

function requireRunningMemoryRun(runs: Map<string, MemoryRun>, runId: string) {
  const run = requireMemoryRun(runs, runId);
  if (run.status !== "running") throw new Error(`Run ${runId} is already terminal`);
  return run;
}

type AgentDatabase = typeof import("@/lib/db").db;
type AgentTransaction = Parameters<Parameters<AgentDatabase["transaction"]>[0]>[0];

async function archivePublicTerminalEvents(
  tx: AgentTransaction,
  runId: string,
) {
  await tx.update(interviewAgentEvents).set({
    visibility: "internal",
  }).where(and(
    eq(interviewAgentEvents.runId, runId),
    eq(interviewAgentEvents.visibility, "public"),
    inArray(interviewAgentEvents.type, ["run_completed", "run_failed"]),
  ));
}

async function notifyAgentEventAppend(
  execute: (query: SQL) => Promise<unknown>,
  runId: string,
  latestSequence: number,
) {
  await execute(sql`SELECT pg_notify(
    'interview_agent_events',
    ${JSON.stringify({ runId, latestSequence })}
  )`);
}

export function createDrizzleInterviewAgentRepository(
  database: AgentDatabase,
): InterviewAgentRepository {
  return {
    async createRun(input) {
      const [existing] = await database
        .select({ id: interviewAgentRuns.id })
        .from(interviewAgentRuns)
        .where(and(
          eq(interviewAgentRuns.interviewId, input.interviewId),
          eq(interviewAgentRuns.idempotencyKey, input.idempotencyKey),
        ))
        .limit(1);
      if (existing) return { id: existing.id, status: "running", created: false };

      const [created] = await database
        .insert(interviewAgentRuns)
        .values({ ...input, streamMode: "durable_provisional" })
        .onConflictDoNothing({
          target: [
            interviewAgentRuns.interviewId,
            interviewAgentRuns.idempotencyKey,
          ],
        })
        .returning({ id: interviewAgentRuns.id });
      if (created) {
        return { id: created.id, status: "running", created: true };
      }
      const [winner] = await database
        .select({ id: interviewAgentRuns.id })
        .from(interviewAgentRuns)
        .where(and(
          eq(interviewAgentRuns.interviewId, input.interviewId),
          eq(interviewAgentRuns.idempotencyKey, input.idempotencyKey),
        ))
        .limit(1);
      if (!winner) throw new Error("Idempotent Agent run could not be resolved");
      return { id: winner.id, status: "running", created: false };
    },
    async appendEvent(runId, event, lease) {
      return database.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${runId}))`);
        const [writableRun] = await tx.select({ id: interviewAgentRuns.id })
          .from(interviewAgentRuns)
          .where(runFenceCondition(runId, lease))
          .limit(1);
        if (!writableRun) throw new Error("Agent run lease is stale");
        if (event.dedupeKey) {
          const [existing] = await tx.select({ sequence: interviewAgentEvents.sequence })
            .from(interviewAgentEvents)
            .where(and(
              eq(interviewAgentEvents.runId, runId),
              eq(interviewAgentEvents.dedupeKey, event.dedupeKey),
            ))
            .limit(1);
          if (existing) return existing;
        }
        const [run] = await tx
          .update(interviewAgentRuns)
          .set({
            lastEventSequence: sql`${interviewAgentRuns.lastEventSequence} + 1`,
            updatedAt: new Date(),
          })
          .where(runFenceCondition(runId, lease))
          .returning({ sequence: interviewAgentRuns.lastEventSequence });
        if (!run) throw new Error(`Unknown run: ${runId}`);
        const visibility = event.visibility ?? "internal";
        await tx.insert(interviewAgentEvents).values({
          runId,
          sequence: run.sequence,
          dedupeKey: event.dedupeKey,
          attemptId: event.attemptId ?? null,
          logicalMessageId: event.logicalMessageId ?? null,
          visibility,
          type: event.type,
          payload: event.payload,
        });
        if (visibility === "public") {
          await notifyAgentEventAppend((query) => tx.execute(query), runId, run.sequence);
        }
        return run;
      });
    },
    async getRun(runId) {
      const [run] = await database.select({
        id: interviewAgentRuns.id,
        interviewId: interviewAgentRuns.interviewId,
        status: interviewAgentRuns.status,
        phase: interviewAgentRuns.phase,
        attemptId: interviewAgentRuns.attemptId,
        attemptNumber: interviewAgentRuns.attemptNumber,
        provisionalMessageId: interviewAgentRuns.provisionalMessageId,
        exitReason: interviewAgentRuns.exitReason,
        leaseOwner: interviewAgentRuns.leaseOwner,
        leaseExpiresAt: interviewAgentRuns.leaseExpiresAt,
        leaseGeneration: interviewAgentRuns.leaseGeneration,
        resumeCount: interviewAgentRuns.resumeCount,
        nextResumeAt: interviewAgentRuns.nextResumeAt,
        checkpoint: interviewAgentRuns.checkpointJson,
        trigger: interviewAgentRuns.triggerJson,
        lastEventSequence: interviewAgentRuns.lastEventSequence,
      }).from(interviewAgentRuns).where(eq(interviewAgentRuns.id, runId)).limit(1);
      return run ? parseRunRecord(run) : null;
    },
    async listEvents(runId, afterSequence, options) {
      const rows = await database.select({
        id: interviewAgentEvents.id,
        runId: interviewAgentEvents.runId,
        sequence: interviewAgentEvents.sequence,
        type: interviewAgentEvents.type,
        visibility: interviewAgentEvents.visibility,
        attemptId: interviewAgentEvents.attemptId,
        logicalMessageId: interviewAgentEvents.logicalMessageId,
        payload: interviewAgentEvents.payload,
        createdAt: interviewAgentEvents.createdAt,
      }).from(interviewAgentEvents)
        .where(and(
          eq(interviewAgentEvents.runId, runId),
          gt(interviewAgentEvents.sequence, afterSequence),
          options?.visibility
            ? eq(interviewAgentEvents.visibility, options.visibility)
            : undefined,
        ))
        .orderBy(asc(interviewAgentEvents.sequence));
      return rows.map((row) => ({
        ...row,
        type: row.type as AgentEventRecord["type"],
        visibility: row.visibility as AgentEventVisibility,
        createdAt: row.createdAt.toISOString(),
      }));
    },
    async claimRun(runId, owner, now, leaseMs) {
      const expiresAt = new Date(now.getTime() + leaseMs);
      const [claimed] = await database.update(interviewAgentRuns).set({
        status: "running",
        exitReason: null,
        errorJson: null,
        completedAt: null,
        resumeCount: sql`CASE WHEN ${interviewAgentRuns.status} = 'failed' OR ${interviewAgentRuns.leaseOwner} IS NOT NULL THEN ${interviewAgentRuns.resumeCount} + 1 ELSE ${interviewAgentRuns.resumeCount} END`,
        nextResumeAt: null,
        leaseOwner: owner,
        leaseExpiresAt: expiresAt,
        leaseGeneration: sql`${interviewAgentRuns.leaseGeneration} + 1`,
        updatedAt: now,
      }).where(and(
        eq(interviewAgentRuns.id, runId),
        or(
          and(
            eq(interviewAgentRuns.status, "running"),
            or(
              isNull(interviewAgentRuns.leaseExpiresAt),
              lte(interviewAgentRuns.leaseExpiresAt, now),
            ),
            or(
              isNull(interviewAgentRuns.leaseOwner),
              sql`${interviewAgentRuns.resumeCount} < ${MAX_AGENT_RUN_RESUMES}`,
            ),
          ),
          and(
            eq(interviewAgentRuns.status, "failed"),
            inArray(interviewAgentRuns.exitReason, RECOVERABLE_RUN_EXIT_REASONS),
            isNotNull(interviewAgentRuns.triggerJson),
            sql`${interviewAgentRuns.resumeCount} < ${MAX_AGENT_RUN_RESUMES}`,
            or(
              isNull(interviewAgentRuns.nextResumeAt),
              lte(interviewAgentRuns.nextResumeAt, now),
            ),
          ),
        ),
      )).returning({
        id: interviewAgentRuns.id,
        interviewId: interviewAgentRuns.interviewId,
        status: interviewAgentRuns.status,
        phase: interviewAgentRuns.phase,
        attemptId: interviewAgentRuns.attemptId,
        attemptNumber: interviewAgentRuns.attemptNumber,
        provisionalMessageId: interviewAgentRuns.provisionalMessageId,
        exitReason: interviewAgentRuns.exitReason,
        leaseOwner: interviewAgentRuns.leaseOwner,
        leaseExpiresAt: interviewAgentRuns.leaseExpiresAt,
        leaseGeneration: interviewAgentRuns.leaseGeneration,
        resumeCount: interviewAgentRuns.resumeCount,
        nextResumeAt: interviewAgentRuns.nextResumeAt,
        checkpoint: interviewAgentRuns.checkpointJson,
        trigger: interviewAgentRuns.triggerJson,
        lastEventSequence: interviewAgentRuns.lastEventSequence,
      });
      if (claimed) return { claimed: true, run: parseRunRecord(claimed) };
      return { claimed: false, run: await this.getRun(runId) };
    },
    async renewLease(runId, lease, now, leaseMs) {
      const rows = await database.update(interviewAgentRuns).set({
        leaseExpiresAt: new Date(now.getTime() + leaseMs),
        updatedAt: now,
      }).where(and(
        eq(interviewAgentRuns.id, runId),
        eq(interviewAgentRuns.status, "running"),
        eq(interviewAgentRuns.leaseOwner, lease.owner),
        eq(interviewAgentRuns.leaseGeneration, lease.generation),
        gt(interviewAgentRuns.leaseExpiresAt, now),
      )).returning({ id: interviewAgentRuns.id });
      return rows.length > 0;
    },
    async releaseLease(runId, lease) {
      const rows = await database.update(interviewAgentRuns).set({
        leaseOwner: null,
        leaseExpiresAt: null,
        updatedAt: new Date(),
      }).where(and(
        eq(interviewAgentRuns.id, runId),
        eq(interviewAgentRuns.leaseOwner, lease.owner),
        eq(interviewAgentRuns.leaseGeneration, lease.generation),
      ))
        .returning({ id: interviewAgentRuns.id });
      return rows.length > 0;
    },
    async startAttempt(runId, input, lease) {
      const rows = await database.update(interviewAgentRuns).set({
        model: input.model,
        attemptId: input.attemptId,
        attemptNumber: input.attemptNumber,
        provisionalMessageId: input.provisionalMessageId,
        phase: "reasoning",
        authorizedProposalJson: null,
        authorizedProposalHash: null,
        proposalAuthorizedAt: null,
        responseStartedAt: null,
        lastProviderProgressAt: input.now,
        updatedAt: input.now,
      }).where(and(
        runFenceCondition(runId, lease),
        sql`${interviewAgentRuns.attemptNumber} < ${input.attemptNumber}`,
      )).returning({ id: interviewAgentRuns.id });
      if (rows.length > 0) return;
      const [current] = await database.select({
        attemptId: interviewAgentRuns.attemptId,
        attemptNumber: interviewAgentRuns.attemptNumber,
        logicalMessageId: interviewAgentRuns.provisionalMessageId,
      }).from(interviewAgentRuns).where(runFenceCondition(runId, lease)).limit(1);
      if (
        current
        && current.attemptNumber === input.attemptNumber
        && current.attemptId === input.attemptId
        && current.logicalMessageId === input.provisionalMessageId
      ) return;
      throw new Error("Agent attempt is stale");
    },
    async authorizeProposal(input) {
      const proposal = parseAuthorizedProposal(input.proposal, input.proposalHash);
      const authorizedAt = input.authorizedAt ?? new Date();
      const rows = await database.update(interviewAgentRuns).set({
        phase: "authorized",
        authorizedProposalJson: proposal,
        authorizedProposalHash: input.proposalHash,
        proposalAuthorizedAt: authorizedAt,
        responseStartedAt: null,
        checkpointJson: input.checkpoint,
        turnCount: input.checkpoint.turnCount,
        updatedAt: authorizedAt,
      }).where(and(
        runAttemptFenceCondition(input),
        inArray(interviewAgentRuns.phase, [
          "reasoning",
          "tool_running",
          "proposal_streaming",
          "repairing",
        ]),
      )).returning({ id: interviewAgentRuns.id });
      if (rows.length === 0) throw new Error("Agent attempt is stale");
      return { authorized: true, proposalHash: input.proposalHash };
    },
    async markResponseStarted(input) {
      const startedAt = input.startedAt ?? new Date();
      const rows = await database.update(interviewAgentRuns).set({
        phase: "responding",
        responseStartedAt: startedAt,
        updatedAt: startedAt,
      }).where(and(
        runAttemptFenceCondition(input),
        eq(interviewAgentRuns.phase, "authorized"),
        eq(interviewAgentRuns.authorizedProposalHash, input.proposalHash),
      )).returning({ id: interviewAgentRuns.id });
      if (rows.length === 0) throw new Error("Agent proposal hash is stale or attempt is stale");
    },
    async recordProviderProgress(runId, now, lease) {
      const rows = await database.update(interviewAgentRuns).set({
        lastProviderProgressAt: now,
        updatedAt: now,
      }).where(runFenceCondition(runId, lease)).returning({ id: interviewAgentRuns.id });
      if (rows.length === 0) throw new Error("Agent run lease is stale");
    },
    async saveRunTrigger(runId, trigger) {
      await database.update(interviewAgentRuns).set({
        triggerJson: trigger,
        updatedAt: new Date(),
      }).where(and(
        eq(interviewAgentRuns.id, runId),
        eq(interviewAgentRuns.status, "running"),
      ));
    },
    async appendMessage(input) {
      if (input.idempotencyKey) {
        const [existing] = await database
          .select({ id: interviewMessages.id, sequence: interviewMessages.sequence })
          .from(interviewMessages)
          .where(and(
            eq(interviewMessages.interviewId, input.interviewId),
            eq(interviewMessages.idempotencyKey, input.idempotencyKey),
          ))
          .limit(1);
        if (existing) return existing;
      }

      return database.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${input.interviewId}))`);
        const [row] = await tx
          .select({ sequence: sql<number>`coalesce(max(${interviewMessages.sequence}), 0) + 1` })
          .from(interviewMessages)
          .where(eq(interviewMessages.interviewId, input.interviewId));
        const [created] = await tx
          .insert(interviewMessages)
          .values({ ...input, sequence: Number(row.sequence) })
          .returning({ id: interviewMessages.id, sequence: interviewMessages.sequence });
        return created;
      });
    },
    async loadState(interviewId) {
      const [interview] = await database
        .select({ candidateRoundCount: interviews.candidateRoundCount, status: interviews.status })
        .from(interviews)
        .where(eq(interviews.id, interviewId))
        .limit(1);
      if (!interview) throw new Error(`Unknown interview: ${interviewId}`);

      const [coverage, questions, assessments] = await Promise.all([
        database.select({
          category: interviewCoverage.category,
          questionCount: interviewCoverage.questionCount,
          status: interviewCoverage.status,
        })
          .from(interviewCoverage)
          .where(and(
            eq(interviewCoverage.interviewId, interviewId),
            eq(interviewCoverage.topic, "__category__"),
          )),
        database.select({ question: interviewQuestions.question })
          .from(interviewQuestions)
          .where(and(eq(interviewQuestions.interviewId, interviewId), isNotNull(interviewQuestions.askedAt)))
          .orderBy(asc(interviewQuestions.questionIndex)),
        database.select({ followUpNeeded: interviewAnswerAssessments.followUpNeeded })
          .from(interviewAnswerAssessments)
          .where(eq(interviewAnswerAssessments.interviewId, interviewId))
          .orderBy(desc(interviewAnswerAssessments.createdAt))
          .limit(2),
      ]);
      return {
        interviewId,
        candidateRoundCount: interview.candidateRoundCount,
        categoryCounts: Object.fromEntries(coverage.map((item) => [item.category, item.questionCount])),
        categoryStatuses: Object.fromEntries(coverage.map((item) => [item.category, item.status])),
        consecutiveNoFollowUpAssessments: assessments.findIndex((item) => item.followUpNeeded !== 0) === -1
          ? assessments.length
          : assessments.findIndex((item) => item.followUpNeeded !== 0),
        recentQuestions: questions.slice(-10).map((item) => item.question),
        requestedUserEnd: interview.status === "completing",
      } as InterviewAgentState;
    },
    async saveCheckpoint(runId, checkpoint, lease) {
      const rows = await database.update(interviewAgentRuns).set({
        checkpointJson: checkpoint,
        turnCount: checkpoint.turnCount,
        ...(checkpoint.phase ? { phase: checkpoint.phase } : {}),
        updatedAt: new Date(),
      }).where(runFenceCondition(runId, lease)).returning({ id: interviewAgentRuns.id });
      if (rows.length === 0) throw new Error("Agent run lease is stale");
    },
    async terminateRun(runId, input, lease) {
      return database.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${runId}))`);
        const [current] = await tx.select({
          status: interviewAgentRuns.status,
          lastEventSequence: interviewAgentRuns.lastEventSequence,
        }).from(interviewAgentRuns).where(eq(interviewAgentRuns.id, runId)).limit(1);
        if (!current) throw new Error(`Unknown run: ${runId}`);
        if (current.status !== "running") {
          return {
            status: current.status as "completed" | "failed",
            eventSequence: current.lastEventSequence,
            created: false,
          };
        }
        const completed = input.exitReason === "completed";
        const now = new Date();
        await archivePublicTerminalEvents(tx, runId);
        const [updated] = await tx.update(interviewAgentRuns).set({
          status: completed ? "completed" : "failed",
          exitReason: input.exitReason,
          errorJson: completed ? null : sanitizeAIError(input.error),
          lastEventSequence: sql`${interviewAgentRuns.lastEventSequence} + 1`,
          completedAt: now,
          updatedAt: now,
          leaseOwner: null,
          leaseExpiresAt: null,
          nextResumeAt: !completed && RECOVERABLE_RUN_EXIT_REASONS.includes(input.exitReason)
            ? sql`CASE
                WHEN ${interviewAgentRuns.resumeCount} >= ${MAX_AGENT_RUN_RESUMES}
                  THEN NULL
                ELSE CURRENT_TIMESTAMP
                  + LEAST(
                      300000,
                      30000 * POWER(2, ${interviewAgentRuns.resumeCount})
                    ) * INTERVAL '1 millisecond'
              END`
            : null,
        }).where(runFenceCondition(runId, lease)).returning({ sequence: interviewAgentRuns.lastEventSequence });
        if (!updated) throw new Error("Agent run lease is stale");
        await tx.insert(interviewAgentEvents).values({
          runId,
          sequence: updated.sequence,
          attemptId: null,
          logicalMessageId: null,
          visibility: "public",
          type: completed ? "run_completed" : "run_failed",
          payload: buildTerminalPayload(runId, input),
        });
        await notifyAgentEventAppend((query) => tx.execute(query), runId, updated.sequence);
        return {
          status: completed ? "completed" as const : "failed" as const,
          eventSequence: updated.sequence,
          created: true,
        };
      });
    },
    async completeRun(runId, exitReason) {
      const result = await this.terminateRun(runId, { exitReason });
      if (!result.created) throw new Error(`Run ${runId} is already terminal`);
    },
    async failRun(runId, exitReason, error) {
      const result = await this.terminateRun(runId, { exitReason, error });
      if (!result.created) throw new Error(`Run ${runId} is already terminal`);
    },
    async commitTurnOutcome(input) {
      return database.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${input.interviewId}))`);
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${input.runId}))`);

        const [run] = await tx.select({
          interviewId: interviewAgentRuns.interviewId,
          model: interviewAgentRuns.model,
          phase: interviewAgentRuns.phase,
          authorizedProposal: interviewAgentRuns.authorizedProposalJson,
          authorizedProposalHash: interviewAgentRuns.authorizedProposalHash,
          responseStartedAt: interviewAgentRuns.responseStartedAt,
        }).from(interviewAgentRuns)
          .where(runAttemptFenceCondition(input))
          .limit(1);
        if (!run) throw new Error("Agent attempt is stale");
        if (run.interviewId !== input.interviewId) {
          throw new Error("Agent run does not belong to interview");
        }

        const [existing] = await tx.select({
          toolName: interviewAgentToolCommits.toolName,
          result: interviewAgentToolCommits.resultJson,
        })
          .from(interviewAgentToolCommits)
          .where(and(
            eq(interviewAgentToolCommits.runId, input.runId),
            eq(interviewAgentToolCommits.toolCallId, input.toolCallId),
          ))
          .limit(1);
        if (existing) {
          if (existing.toolName !== "submit_interview_turn") {
            throw new Error("Agent tool call id is already committed by another tool");
          }
          return existing.result as CommittedTurnOutcome;
        }
        if (
          run.phase !== "committing"
          || !run.responseStartedAt
          || run.authorizedProposalHash !== input.proposalHash
        ) {
          throw new Error("Agent proposal hash is stale or response has not started");
        }
        const terminalProposal = interviewTurnProposalSchema.parse({
          ...input.proposal,
          responseText: input.responseText,
        });
        const { responseText, ...proposalInput } = terminalProposal;
        const proposal = parseAuthorizedProposal(proposalInput, input.proposalHash);
        const storedProposal = turnProposalPrefixSchema.parse(run.authorizedProposal);
        if (hashTurnProposalPrefix(storedProposal) !== input.proposalHash) {
          throw new Error("Agent proposal hash is stale");
        }
        if (proposal.coverageChanges.some((change) => change.topic === "__category__")) {
          throw new Error("Reserved coverage topic cannot be proposed");
        }

        const [interview] = await tx.select({
          candidateRoundCount: interviews.candidateRoundCount,
          status: interviews.status,
          language: interviews.language,
        }).from(interviews)
          .where(eq(interviews.id, input.interviewId))
          .limit(1);
        if (!interview) throw new Error(`Unknown interview: ${input.interviewId}`);
        if (interview.language !== input.language) {
          throw new Error("Interview language does not match authoritative configuration");
        }

        let mode: "opening" | "answer" = "opening";
        let answerCategory: QuestionCategory | null = null;
        let answerQuestionId: string | null = null;
        if (input.answerMessageId) {
          const [answer] = await tx.select({
            runId: interviewMessages.runId,
            role: interviewMessages.role,
            kind: interviewMessages.kind,
            questionId: interviewMessages.questionId,
          }).from(interviewMessages).where(and(
            eq(interviewMessages.id, input.answerMessageId),
            eq(interviewMessages.interviewId, input.interviewId),
            eq(interviewMessages.runId, input.runId),
          )).limit(1);
          if (
            !answer
            || answer.runId !== input.runId
            || answer.role !== "user"
            || answer.kind !== "answer"
            || !answer.questionId
          ) {
            throw new Error("Answer message does not belong to this interview question");
          }
          const [question] = await tx.select({
            id: interviewQuestions.id,
            category: interviewQuestions.questionType,
          }).from(interviewQuestions).where(and(
            eq(interviewQuestions.id, answer.questionId),
            eq(interviewQuestions.interviewId, input.interviewId),
          )).limit(1);
          if (!question) throw new Error("Answer question does not belong to interview");
          mode = "answer";
          answerCategory = questionCategorySchema.parse(question.category);
          answerQuestionId = question.id;
        }

        const [coverage, questions, assessments] = await Promise.all([
          tx.select({
            category: interviewCoverage.category,
            questionCount: interviewCoverage.questionCount,
            status: interviewCoverage.status,
          }).from(interviewCoverage).where(and(
            eq(interviewCoverage.interviewId, input.interviewId),
            eq(interviewCoverage.topic, "__category__"),
          )),
          tx.select({ question: interviewQuestions.question })
            .from(interviewQuestions)
            .where(and(
              eq(interviewQuestions.interviewId, input.interviewId),
              isNotNull(interviewQuestions.askedAt),
            ))
            .orderBy(asc(interviewQuestions.questionIndex)),
          tx.select({ followUpNeeded: interviewAnswerAssessments.followUpNeeded })
            .from(interviewAnswerAssessments)
            .where(eq(interviewAnswerAssessments.interviewId, input.interviewId))
            .orderBy(desc(interviewAnswerAssessments.createdAt))
            .limit(2),
        ]);
        const state: InterviewAgentState = {
          interviewId: input.interviewId,
          candidateRoundCount: interview.candidateRoundCount,
          categoryCounts: Object.fromEntries(
            coverage.map((item) => [item.category, item.questionCount]),
          ),
          categoryStatuses: Object.fromEntries(
            coverage.map((item) => [item.category, item.status]),
          ) as Partial<Record<QuestionCategory, CoverageStatus>>,
          consecutiveNoFollowUpAssessments:
            assessments.findIndex((item) => item.followUpNeeded !== 0) === -1
              ? assessments.length
              : assessments.findIndex((item) => item.followUpNeeded !== 0),
          recentQuestions: questions.slice(-10).map((item) => item.question),
          requestedUserEnd: interview.status === "completing",
        };
        const authorization = authorizeTurnProposal({
          state,
          mode,
          answerCategory,
          prefix: proposal,
          responseText,
        });
        if (!authorization.allowed) {
          throw new Error(`Turn proposal rejected: ${authorization.reason}`);
        }
        if (proposal.decision.action !== "finish" && interview.status !== "active") {
          throw new Error("INTERVIEW_NOT_ACTIVE");
        }

        const now = new Date();
        let assessmentId: string | null = null;
        if (proposal.assessment && input.answerMessageId && answerQuestionId && answerCategory) {
          const [assessment] = await tx.insert(interviewAnswerAssessments).values({
            interviewId: input.interviewId,
            questionId: answerQuestionId,
            answerMessageId: input.answerMessageId,
            completeness: proposal.assessment.completeness,
            specificity: proposal.assessment.specificity,
            evidenceStrength: proposal.assessment.evidenceStrength,
            reflectionDepth: proposal.assessment.reflectionDepth,
            followUpNeeded: proposal.assessment.followUpNeeded ? 1 : 0,
            missingPoints: proposal.assessment.missingPoints,
            extractedEvidence: proposal.assessment.extractedEvidence,
            publicSummary: proposal.assessment.publicSummary,
            model: run.model,
          }).returning({ id: interviewAnswerAssessments.id });
          assessmentId = assessment.id;
          const projected = projectAssessmentCoverage(proposal.assessment);
          await tx.insert(interviewCoverage).values({
            interviewId: input.interviewId,
            category: answerCategory,
            topic: "__category__",
            resumeEvidenceIds: [],
            questionCount: state.categoryCounts[answerCategory] ?? 0,
            depth: projected.depth,
            evidenceQuality: projected.evidenceQuality,
            status: (state.categoryCounts[answerCategory] ?? 0) >= 3
              ? "exhausted"
              : projected.status,
            lastAssessmentId: assessmentId,
          }).onConflictDoUpdate({
            target: [
              interviewCoverage.interviewId,
              interviewCoverage.category,
              interviewCoverage.topic,
            ],
            set: {
              depth: projected.depth,
              evidenceQuality: projected.evidenceQuality,
              status: (state.categoryCounts[answerCategory] ?? 0) >= 3
                ? "exhausted"
                : projected.status,
              lastAssessmentId: assessmentId,
              updatedAt: now,
            },
          });
        }

        for (const change of authorization.prefix.coverageChanges) {
          await tx.insert(interviewCoverage).values({
            interviewId: input.interviewId,
            category: change.category,
            topic: change.topic,
            status: change.status,
            resumeEvidenceIds: change.resumeEvidenceIds,
          }).onConflictDoUpdate({
            target: [
              interviewCoverage.interviewId,
              interviewCoverage.category,
              interviewCoverage.topic,
            ],
            set: {
              status: change.status,
              resumeEvidenceIds: change.resumeEvidenceIds,
              updatedAt: now,
            },
          });
        }

        let questionId: string | null = null;
        let messageKind: CommittedTurnOutcome["message"]["kind"];
        if (proposal.decision.action === "finish") {
          if (interview.status !== "active" && interview.status !== "completing") {
            throw new Error("INTERVIEW_NOT_ACTIVE");
          }
          const changed = await tx.update(interviews).set({
            status: "scoring",
            updatedAt: now,
          }).where(and(
            eq(interviews.id, input.interviewId),
            inArray(interviews.status, ["active", "completing"]),
          )).returning({ id: interviews.id });
          if (changed.length === 0) throw new Error("INTERVIEW_NOT_ACTIVE");
          await tx.insert(interviewCompletionJobs).values({
            interviewId: input.interviewId,
          }).onConflictDoNothing({ target: interviewCompletionJobs.interviewId });
          messageKind = "finish";
        } else {
          const category = proposal.decision.category;
          const [indexRow] = await tx.select({
            next: sql<number>`coalesce(max(${interviewQuestions.questionIndex}), 0) + 1`,
          }).from(interviewQuestions)
            .where(eq(interviewQuestions.interviewId, input.interviewId));
          const [question] = await tx.insert(interviewQuestions).values({
            interviewId: input.interviewId,
            questionIndex: Number(indexRow.next),
            questionType: category,
            topic: proposal.decision.coverageTarget,
            question: responseText,
            tip: "",
          }).returning({ id: interviewQuestions.id });
          questionId = question.id;
          const [categoryCoverage] = await tx.insert(interviewCoverage).values({
            interviewId: input.interviewId,
            category,
            topic: "__category__",
            resumeEvidenceIds: proposal.decision.evidenceIds,
            questionCount: 1,
            status: "partial",
          }).onConflictDoUpdate({
            target: [
              interviewCoverage.interviewId,
              interviewCoverage.category,
              interviewCoverage.topic,
            ],
            set: {
              questionCount: sql`${interviewCoverage.questionCount} + 1`,
              resumeEvidenceIds: proposal.decision.evidenceIds,
              status: sql`CASE WHEN ${interviewCoverage.questionCount} + 1 >= 3 THEN 'exhausted' ELSE 'partial' END`,
              updatedAt: now,
            },
          }).returning({ count: interviewCoverage.questionCount });
          if (categoryCoverage.count > 3) throw new Error("CATEGORY_LIMIT_REACHED");
          messageKind = proposal.decision.action === "clarify"
            ? "clarification"
            : "question";
        }

        const [sequenceRow] = await tx.select({
          sequence: sql<number>`coalesce(max(${interviewMessages.sequence}), 0) + 1`,
        }).from(interviewMessages)
          .where(eq(interviewMessages.interviewId, input.interviewId));
        const messageSequence = Number(sequenceRow.sequence);
        const [createdMessage] = await tx.insert(interviewMessages).values({
          id: input.logicalMessageId,
          interviewId: input.interviewId,
          runId: input.runId,
          sequence: messageSequence,
          role: "assistant",
          kind: messageKind,
          content: responseText,
          questionId,
          metadata: {
            proposalHash: input.proposalHash,
            decision: proposal.decision,
            assessmentId,
          },
        }).returning({ id: interviewMessages.id });
        const message: CommittedTurnOutcome["message"] = {
          id: createdMessage.id,
          runId: input.runId,
          sequence: messageSequence,
          role: "assistant",
          kind: messageKind,
          content: responseText,
        };
        const [updatedRun] = await tx.update(interviewAgentRuns).set({
          phase: "acting",
          lastEventSequence: sql`${interviewAgentRuns.lastEventSequence} + 1`,
          updatedAt: now,
        }).where(runAttemptFenceCondition(input)).returning({
          sequence: interviewAgentRuns.lastEventSequence,
        });
        if (!updatedRun) throw new Error("Agent attempt is stale");
        await tx.insert(interviewAgentEvents).values({
          runId: input.runId,
          sequence: updatedRun.sequence,
          attemptId: input.attemptId,
          logicalMessageId: input.logicalMessageId,
          visibility: "public",
          type: "message_committed",
          payload: {
            runId: input.runId,
            attemptId: input.attemptId,
            logicalMessageId: input.logicalMessageId,
            message,
          },
        });
        const outcome: CommittedTurnOutcome = {
          messageId: message.id,
          messageSequence,
          responseText,
          message,
          committedEventSequence: updatedRun.sequence,
          committed: true,
        };
        await tx.insert(interviewAgentToolCommits).values({
          runId: input.runId,
          toolCallId: input.toolCallId,
          toolName: "submit_interview_turn",
          resultJson: outcome,
        });
        await notifyAgentEventAppend(
          (query) => tx.execute(query),
          input.runId,
          updatedRun.sequence,
        );
        return outcome;
      });
    },
    async commitQuestionOutcome(input) {
      return database.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${input.interviewId}))`);
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${input.runId}))`);
        const [leasedRun] = await tx.select({ id: interviewAgentRuns.id })
          .from(interviewAgentRuns)
          .where(runFenceCondition(input.runId, input.lease))
          .limit(1);
        if (!leasedRun) throw new Error("Agent run lease is stale");
        const [existing] = await tx.select({ result: interviewAgentToolCommits.resultJson })
          .from(interviewAgentToolCommits)
          .where(and(
            eq(interviewAgentToolCommits.runId, input.runId),
            eq(interviewAgentToolCommits.toolCallId, input.toolCallId),
          ))
          .limit(1);
        if (existing) return existing.result as QuestionOutcome;
        const [interview] = await tx.select({ status: interviews.status })
          .from(interviews)
          .where(eq(interviews.id, input.interviewId))
          .limit(1);
        if (interview?.status !== "active") throw new Error("INTERVIEW_NOT_ACTIVE");
        if (input.targetRole) {
          await tx.update(interviews).set({
            targetRole: input.targetRole.value,
            targetRoleStatus: input.targetRole.status,
            targetRoleConfidence: input.targetRole.confidence,
            targetRoleSourceIds: input.targetRole.sourceIds,
            updatedAt: new Date(),
          }).where(and(
            eq(interviews.id, input.interviewId),
            eq(interviews.status, "active"),
          ));
        }
        const [coverage] = await tx.select({ count: interviewCoverage.questionCount })
          .from(interviewCoverage)
          .where(and(
            eq(interviewCoverage.interviewId, input.interviewId),
            eq(interviewCoverage.category, input.category),
            eq(interviewCoverage.topic, "__category__"),
          ))
          .limit(1);
        if (!coverage || coverage.count >= 3) throw new Error("CATEGORY_LIMIT_REACHED");
        const [indexRow] = await tx.select({ next: sql<number>`coalesce(max(${interviewQuestions.questionIndex}), 0) + 1` })
          .from(interviewQuestions)
          .where(eq(interviewQuestions.interviewId, input.interviewId));
        const [question] = await tx.insert(interviewQuestions).values({
          interviewId: input.interviewId,
          questionIndex: Number(indexRow.next),
          questionType: input.category,
          topic: input.topic,
          question: input.question,
          tip: "",
        }).returning({ id: interviewQuestions.id });
        const [sequenceRow] = await tx.select({
          sequence: sql<number>`coalesce(max(${interviewMessages.sequence}), 0) + 1`,
        }).from(interviewMessages).where(eq(interviewMessages.interviewId, input.interviewId));
        const [message] = await tx.insert(interviewMessages).values({
          ...(input.provisionalMessageId ? { id: input.provisionalMessageId } : {}),
          interviewId: input.interviewId,
          runId: input.runId,
          sequence: Number(sequenceRow.sequence),
          role: "assistant",
          kind: "question",
          content: input.responseText,
          questionId: question.id,
        }).returning({ id: interviewMessages.id, sequence: interviewMessages.sequence });
        const updatedCoverage = await tx.update(interviewCoverage).set({
          questionCount: sql`${interviewCoverage.questionCount} + 1`,
          resumeEvidenceIds: input.resumeEvidenceIds,
          status: "partial",
          updatedAt: new Date(),
        }).where(and(
          eq(interviewCoverage.interviewId, input.interviewId),
          eq(interviewCoverage.category, input.category),
          eq(interviewCoverage.topic, "__category__"),
          sql`${interviewCoverage.questionCount} < 3`,
        )).returning({ count: interviewCoverage.questionCount });
        if (updatedCoverage.length === 0) throw new Error("CATEGORY_LIMIT_REACHED");
        const outcome: QuestionOutcome = {
          questionId: question.id,
          messageId: message.id,
          messageSequence: message.sequence,
          responseText: input.responseText,
          committed: true,
        };
        await tx.insert(interviewAgentToolCommits).values({
          runId: input.runId,
          toolCallId: input.toolCallId,
          toolName: "ask_interview_question",
          resultJson: outcome,
        });
        return outcome;
      });
    },
    async commitCoverageUpdate(input) {
      return database.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${input.runId}))`);
        const [leasedRun] = await tx.select({ id: interviewAgentRuns.id })
          .from(interviewAgentRuns)
          .where(runFenceCondition(input.runId, input.lease))
          .limit(1);
        if (!leasedRun) throw new Error("Agent run lease is stale");
        const [existing] = await tx.select({ result: interviewAgentToolCommits.resultJson })
          .from(interviewAgentToolCommits)
          .where(and(
            eq(interviewAgentToolCommits.runId, input.runId),
            eq(interviewAgentToolCommits.toolCallId, input.toolCallId),
          ))
          .limit(1);
        if (existing) return existing.result as { updated: true };
        const [interview] = await tx.select({ status: interviews.status })
          .from(interviews)
          .where(eq(interviews.id, input.interviewId))
          .limit(1);
        if (interview?.status !== "active") throw new Error("INTERVIEW_NOT_ACTIVE");
        await tx.insert(interviewCoverage).values({
          interviewId: input.interviewId,
          category: input.category,
          topic: input.topic,
          status: input.status,
          resumeEvidenceIds: input.resumeEvidenceIds,
        }).onConflictDoUpdate({
          target: [
            interviewCoverage.interviewId,
            interviewCoverage.category,
            interviewCoverage.topic,
          ],
          set: {
            status: input.status,
            resumeEvidenceIds: input.resumeEvidenceIds,
            updatedAt: new Date(),
          },
        });
        const result = { updated: true as const };
        await tx.insert(interviewAgentToolCommits).values({
          runId: input.runId,
          toolCallId: input.toolCallId,
          toolName: "update_coverage",
          resultJson: result,
        });
        return result;
      });
    },
    async commitFinishOutcome(input) {
      return database.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${input.interviewId}))`);
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${input.runId}))`);
        const [leasedRun] = await tx.select({ id: interviewAgentRuns.id })
          .from(interviewAgentRuns)
          .where(runFenceCondition(input.runId, input.lease))
          .limit(1);
        if (!leasedRun) throw new Error("Agent run lease is stale");
        const [existing] = await tx.select({ result: interviewAgentToolCommits.resultJson })
          .from(interviewAgentToolCommits)
          .where(and(
            eq(interviewAgentToolCommits.runId, input.runId),
            eq(interviewAgentToolCommits.toolCallId, input.toolCallId),
          ))
          .limit(1);
        if (existing) return existing.result as FinishOutcome;
        const changed = await tx.update(interviews).set({
          status: "scoring",
          updatedAt: new Date(),
        }).where(and(
          eq(interviews.id, input.interviewId),
          eq(interviews.status, "active"),
        )).returning({ id: interviews.id });
        if (changed.length === 0) throw new Error("INTERVIEW_NOT_ACTIVE");
        await tx.insert(interviewCompletionJobs).values({
          interviewId: input.interviewId,
        }).onConflictDoNothing({ target: interviewCompletionJobs.interviewId });
        const [sequenceRow] = await tx.select({
          sequence: sql<number>`coalesce(max(${interviewMessages.sequence}), 0) + 1`,
        }).from(interviewMessages).where(eq(interviewMessages.interviewId, input.interviewId));
        const [message] = await tx.insert(interviewMessages).values({
          interviewId: input.interviewId,
          runId: input.runId,
          sequence: Number(sequenceRow.sequence),
          role: "assistant",
          kind: "finish",
          content: input.closingMessage,
        }).returning({ id: interviewMessages.id, sequence: interviewMessages.sequence });
        const outcome: FinishOutcome = {
          messageId: message.id,
          messageSequence: message.sequence,
          responseText: input.closingMessage,
          committed: true,
        };
        await tx.insert(interviewAgentToolCommits).values({
          runId: input.runId,
          toolCallId: input.toolCallId,
          toolName: "finish_interview",
          resultJson: outcome,
        });
        return outcome;
      });
    },
    async markInterviewCompleting(interviewId) {
      return database.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${interviewId}))`);
        const changed = await tx.update(interviews).set({
          status: "completing",
          updatedAt: new Date(),
        }).where(and(eq(interviews.id, interviewId), eq(interviews.status, "active")))
          .returning({ id: interviews.id });
        if (changed.length === 0) return { changed: false, invalidatedRunIds: [] };
        await tx.insert(interviewCompletionJobs).values({ interviewId })
          .onConflictDoNothing({ target: interviewCompletionJobs.interviewId });
        const activeRuns = await tx.select({ id: interviewAgentRuns.id })
          .from(interviewAgentRuns).where(and(
          eq(interviewAgentRuns.interviewId, interviewId),
          eq(interviewAgentRuns.status, "running"),
        ));
        const invalidatedRunIds: string[] = [];
        for (const run of activeRuns) {
          await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${run.id}))`);
          const [invalidated] = await tx.update(interviewAgentRuns).set({
            status: "failed",
            exitReason: "aborted_tools",
            errorJson: sanitizeAIError(new Error("Interview ended by user")),
            lastEventSequence: sql`${interviewAgentRuns.lastEventSequence} + 1`,
            leaseOwner: null,
            leaseExpiresAt: null,
            leaseGeneration: sql`${interviewAgentRuns.leaseGeneration} + 1`,
            completedAt: new Date(),
            updatedAt: new Date(),
          }).where(and(
            eq(interviewAgentRuns.id, run.id),
            eq(interviewAgentRuns.status, "running"),
          )).returning({ sequence: interviewAgentRuns.lastEventSequence });
          if (!invalidated) continue;
          await archivePublicTerminalEvents(tx, run.id);
          await tx.insert(interviewAgentEvents).values({
            runId: run.id,
            sequence: invalidated.sequence,
            dedupeKey: "terminal",
            attemptId: null,
            logicalMessageId: null,
            visibility: "public",
            type: "run_failed",
            payload: buildTerminalPayload(run.id, {
              exitReason: "aborted_tools",
              userMessage: "用户已结束面试。",
            }),
          });
          await notifyAgentEventAppend((query) => tx.execute(query), run.id, invalidated.sequence);
          invalidatedRunIds.push(run.id);
        }
        return { changed: true, invalidatedRunIds };
      });
    },
  };
}

function parseRunRecord(row: {
  id: string;
  interviewId: string;
  status: string;
  phase: string;
  attemptId: string | null;
  attemptNumber: number;
  provisionalMessageId: string | null;
  exitReason: string | null;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  leaseGeneration: number;
  resumeCount: number;
  nextResumeAt: Date | null;
  checkpoint: unknown;
  trigger: unknown;
  lastEventSequence: number;
}): AgentRunRecord {
  return {
    ...row,
    status: row.status as AgentRunRecord["status"],
    phase: row.phase as AgentRunPhase,
    exitReason: row.exitReason as AgentExitReason | null,
    checkpoint: row.checkpoint as AgentCheckpoint | null,
    trigger: row.trigger as AgentRunTrigger | null,
  };
}

function runAttemptFenceCondition(input: {
  runId: string;
  lease: RunLeaseToken;
  attemptId: string;
  logicalMessageId: string;
}) {
  return and(
    runFenceCondition(input.runId, input.lease),
    eq(interviewAgentRuns.attemptId, input.attemptId),
    eq(interviewAgentRuns.provisionalMessageId, input.logicalMessageId),
  );
}

function runFenceCondition(runId: string, lease?: RunLeaseToken) {
  return and(
    eq(interviewAgentRuns.id, runId),
    eq(interviewAgentRuns.status, "running"),
    ...(lease ? [
      eq(interviewAgentRuns.leaseOwner, lease.owner),
      eq(interviewAgentRuns.leaseGeneration, lease.generation),
    ] : []),
  );
}

function buildTerminalPayload(
  runId: string,
  input: {
    exitReason: AgentExitReason;
    retryable?: boolean;
    userMessage?: string;
  },
) {
  return terminalRunPayloadSchema.parse({
    runId,
    exitReason: input.exitReason,
    retryable: input.retryable ?? input.exitReason === "aborted_streaming",
    userMessage: input.userMessage ?? agentExitMessage(input.exitReason),
  });
}
