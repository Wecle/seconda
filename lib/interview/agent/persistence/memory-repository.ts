import type {
  AgentCheckpoint,
  AgentEventRecord,
  AgentExitReason,
  CoverageStatus,
  InterviewAgentState,
  InterviewMessageKind,
  QuestionCategory,
} from "@/lib/interview/agent/protocols/events";
import { questionCategorySchema } from "@/lib/interview/agent/domain/interview";
import {
  authorizeTurnProposal,
  projectAssessmentCoverage,
} from "@/lib/interview/agent/domain/turn-authorizer";
import {
  hashTurnProposalPrefix,
  interviewTurnProposalSchema,
  type TurnProposalPrefix,
} from "@/lib/interview/agent/domain/turn-proposal";
import {
  buildTerminalPayload,
  parseAuthorizedProposal,
} from "@/lib/interview/agent/persistence/invariants";
import {
  RECOVERABLE_RUN_EXIT_REASONS,
  MAX_AGENT_RUN_RESUMES,
  type AgentRunPhase,
  type AgentRunRecord,
  type AgentRunTrigger,
  type CommitTurnOutcomeInput,
  type CommittedTurnOutcome,
  type FinishOutcome,
  type InterviewAgentRepository,
  type QuestionOutcome,
  type QuestionOutcomeInput,
  type RunLeaseToken,
} from "@/lib/interview/agent/persistence/repository";

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
      for (const event of run.events) {
        if (
          event.visibility === "public"
          && (event.type === "run_completed" || event.type === "run_failed")
        ) {
          event.visibility = "internal";
        }
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
