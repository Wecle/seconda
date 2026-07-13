import { and, desc, eq } from "drizzle-orm";
import {
  interviewAnswerAssessments,
  interviewContextSnapshots,
  interviewCoverage,
  interviewMessages,
  interviewQuestions,
  interviewResumeSnapshots,
  interviews,
} from "@/lib/db/schema";
import {
  interviewLanguageValues,
  interviewPersonaValues,
} from "@/lib/interview/settings";
import { z } from "zod";
import { questionCategorySchema } from "../contracts";
import { indexResumeEvidence } from "./resume-evidence";
import { buildPromptPipe, canonicalJson } from "./prompt-pipe";

export const PROMPT_TEMPLATE_VERSION = "interview-agent-v2";

export function assembleAgentContext(input: {
  language: string;
  persona: string;
  preference: string | null;
  targetRole: string | null;
  targetRoleStatus?: string | null;
  targetRoleConfidence?: string | null;
  targetRoleSourceIds?: string[] | null;
  resumeOverview: string;
  evidenceDirectory: unknown;
  cacheEpoch: number;
  checkpointSummary: string;
  coverage: unknown;
  recentMessages: Array<{
    id: string;
    sequence: number;
    role: string;
    kind: string;
    content: string;
    sourceId?: string;
  }>;
  currentInstruction: string;
  runId: string;
  latestAnswer?: {
    id: string;
    category: string;
    content: string;
  } | null;
  priorAssessments?: Array<{
    id: string;
    answerMessageId: string;
    publicSummary: string;
    followUpNeeded: boolean;
  }>;
  contextWindow?: number;
  outputReserve?: number;
}) {
  return {
    templateVersion: PROMPT_TEMPLATE_VERSION,
    cacheEpoch: input.cacheEpoch,
    ...buildPromptPipe({
      stableSegments: [
        {
          id: "interview-config",
          version: PROMPT_TEMPLATE_VERSION,
          priority: 100,
          cacheScope: "interview",
          trimPolicy: "never",
          content: canonicalJson({
            language: input.language,
            persona: input.persona,
            preference: input.preference ?? "",
            targetRole: input.targetRole ?? "",
            targetRoleStatus: input.targetRoleStatus ?? "",
            targetRoleConfidence: input.targetRoleConfidence ?? "",
            targetRoleSourceIds: input.targetRoleSourceIds ?? [],
          }),
        },
        {
          id: "resume-overview",
          version: "1",
          priority: 90,
          cacheScope: "interview",
          trimPolicy: "never",
          content: canonicalJson({
            overview: input.resumeOverview,
            evidenceDirectory: input.evidenceDirectory,
          }),
        },
        {
          id: "checkpoint",
          version: String(input.cacheEpoch),
          priority: 80,
          cacheScope: "epoch",
          trimPolicy: "never",
          content: canonicalJson({
            summary: input.checkpointSummary,
            coverage: input.coverage,
          }),
        },
      ],
      tailSegments: [
        ...(input.priorAssessments?.length ? [{
          id: "prior-assessments",
          version: input.priorAssessments.map((assessment) => assessment.id).join(":"),
          priority: 90,
          cacheScope: "turn" as const,
          trimPolicy: "never" as const,
          content: canonicalJson(input.priorAssessments),
        }] : []),
        ...(input.latestAnswer ? [{
          id: "latest-raw-answer",
          version: input.latestAnswer.id,
          priority: 100,
          cacheScope: "turn" as const,
          trimPolicy: "never" as const,
          content: canonicalJson(input.latestAnswer),
        }] : []),
        {
          id: "recent-messages",
          version: "1",
          priority: 50,
          cacheScope: "turn",
          trimPolicy: "drop",
          content: canonicalJson(input.recentMessages.slice(-8)),
        },
        {
          id: "current-instruction",
          version: "1",
          priority: 100,
          cacheScope: "turn",
          trimPolicy: "never",
          content: canonicalJson({
            instruction: input.currentInstruction,
            runId: input.runId,
          }),
        },
      ],
      contextWindow: input.contextWindow ?? 128_000,
      outputReserve: input.outputReserve ?? 8_000,
    }),
  };
}

type AgentDatabase = typeof import("@/lib/db").db;

export async function loadAgentContext(
  database: AgentDatabase,
  input: {
    interviewId: string;
    runId: string;
    currentInstruction: string;
    mode: "opening" | "answer";
  },
) {
  const [interviewRows, coverage, messages, snapshots, assessments, answerRows] = await Promise.all([
    database.select({
      language: interviews.language,
      persona: interviews.persona,
      preference: interviews.preference,
      targetRole: interviews.targetRole,
      targetRoleStatus: interviews.targetRoleStatus,
      targetRoleConfidence: interviews.targetRoleConfidence,
      targetRoleSourceIds: interviews.targetRoleSourceIds,
      parsedJson: interviewResumeSnapshots.parsedJson,
      extractedText: interviewResumeSnapshots.extractedText,
    }).from(interviews)
      .innerJoin(interviewResumeSnapshots, eq(interviewResumeSnapshots.interviewId, interviews.id))
      .where(eq(interviews.id, input.interviewId))
      .limit(1),
    database.select({
      category: interviewCoverage.category,
      questionCount: interviewCoverage.questionCount,
      status: interviewCoverage.status,
    }).from(interviewCoverage).where(eq(interviewCoverage.interviewId, input.interviewId)),
    database.select({
      id: interviewMessages.id,
      sequence: interviewMessages.sequence,
      role: interviewMessages.role,
      kind: interviewMessages.kind,
      content: interviewMessages.content,
    }).from(interviewMessages)
      .where(eq(interviewMessages.interviewId, input.interviewId))
      .orderBy(desc(interviewMessages.sequence))
      .limit(8),
    database.select({
      cacheEpoch: interviewContextSnapshots.cacheEpoch,
      throughMessageSequence: interviewContextSnapshots.throughMessageSequence,
      summary: interviewContextSnapshots.summary,
    }).from(interviewContextSnapshots)
      .where(eq(interviewContextSnapshots.interviewId, input.interviewId))
      .orderBy(desc(interviewContextSnapshots.cacheEpoch))
      .limit(1),
    database.select({
      id: interviewAnswerAssessments.id,
      answerMessageId: interviewAnswerAssessments.answerMessageId,
      publicSummary: interviewAnswerAssessments.publicSummary,
      followUpNeeded: interviewAnswerAssessments.followUpNeeded,
    }).from(interviewAnswerAssessments)
      .where(eq(interviewAnswerAssessments.interviewId, input.interviewId))
      .orderBy(desc(interviewAnswerAssessments.createdAt))
      .limit(8),
    database.select({
      id: interviewMessages.id,
      content: interviewMessages.content,
      category: interviewQuestions.questionType,
    }).from(interviewMessages)
      .innerJoin(interviewQuestions, eq(interviewQuestions.id, interviewMessages.questionId))
      .where(and(
        eq(interviewMessages.interviewId, input.interviewId),
        eq(interviewMessages.runId, input.runId),
        eq(interviewMessages.role, "user"),
        eq(interviewMessages.kind, "answer"),
      ))
      .orderBy(desc(interviewMessages.sequence))
      .limit(1),
  ]);
  const interview = interviewRows[0];
  if (!interview) throw new Error("Interview context not found");
  const evidence = indexResumeEvidence(interview.parsedJson, interview.extractedText ?? "");
  const snapshot = snapshots[0];
  const latestAnswer = input.mode === "answer" ? answerRows[0] : null;
  if (input.mode === "answer" && !latestAnswer) {
    throw new Error("Current answer context not found");
  }
  const language = z.enum(interviewLanguageValues).parse(interview.language);
  const persona = z.enum(interviewPersonaValues).parse(interview.persona);
  const priorAssessments = assessments.map((assessment) => ({
    id: assessment.id,
    answerMessageId: assessment.answerMessageId,
    publicSummary: assessment.publicSummary,
    followUpNeeded: assessment.followUpNeeded === 1,
  })).reverse();
  const assembled = assembleAgentContext({
    language: interview.language,
    persona: interview.persona,
    preference: interview.preference,
    targetRole: interview.targetRole,
    targetRoleStatus: interview.targetRoleStatus,
    targetRoleConfidence: interview.targetRoleConfidence,
    targetRoleSourceIds: interview.targetRoleSourceIds,
    resumeOverview: evidence.overview,
    evidenceDirectory: evidence.directory,
    cacheEpoch: snapshot?.cacheEpoch ?? 0,
    checkpointSummary: snapshot?.summary ?? "",
    coverage,
    recentMessages: messages.reverse()
      .filter((message) => message.sequence > (snapshot?.throughMessageSequence ?? 0))
      .map((message) => ({
        ...message,
        ...(message.role === "user" ? { sourceId: `answer:${message.id}` } : {}),
      })),
    currentInstruction: input.currentInstruction,
    runId: input.runId,
    latestAnswer: latestAnswer ? {
      id: latestAnswer.id,
      category: latestAnswer.category,
      content: latestAnswer.content,
    } : null,
    priorAssessments,
    contextWindow: readPositiveInteger(process.env.INTERVIEW_AGENT_CONTEXT_WINDOW, 128_000),
    outputReserve: readPositiveInteger(process.env.INTERVIEW_AGENT_OUTPUT_RESERVE, 8_000),
  });
  return {
    ...assembled,
    turnContext: {
      mode: input.mode,
      answerCategory: latestAnswer
        ? questionCategorySchema.parse(latestAnswer.category)
        : null,
      answerMessageId: latestAnswer?.id ?? null,
      language,
      persona,
      allowedTerms: collectAllowedTerms({
        evidence,
        preference: interview.preference,
        targetRole: interview.targetRole,
        candidateMessages: messages,
        currentAnswer: latestAnswer?.content ?? null,
      }),
    },
  };
}

export function collectAllowedTerms(input: {
  evidence: ReturnType<typeof indexResumeEvidence>;
  preference: string | null;
  targetRole: string | null;
  candidateMessages: Array<{
    role: string;
    kind: string;
    content: string;
  }>;
  currentAnswer: string | null;
}) {
  const authorizedSources = {
    immutableResume: {
      overview: input.evidence.overview,
      rawText: input.evidence.rawText,
      records: input.evidence.records.map((record) => ({
        label: record.label,
        content: record.content,
      })),
    },
    deterministicConfiguration: {
      preference: input.preference,
      targetRole: input.targetRole,
    },
    candidateRawMessages: input.candidateMessages
      .filter((message) => message.role === "user" && message.kind === "answer")
      .map((message) => message.content),
    currentAnswer: input.currentAnswer,
  };
  return [...new Set(
    collectStrings(authorizedSources).map((value) => value.trim()).filter(Boolean),
  )];
}

function collectStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  if (!value || typeof value !== "object") return [];
  return Object.values(value).flatMap(collectStrings);
}

function readPositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
