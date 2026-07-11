import { desc, eq } from "drizzle-orm";
import {
  interviewContextSnapshots,
  interviewCoverage,
  interviewMessages,
  interviews,
  resumeVersions,
} from "@/lib/db/schema";
import { indexResumeEvidence } from "./resume-evidence";
import { buildPromptPipe, canonicalJson } from "./prompt-pipe";

export const PROMPT_TEMPLATE_VERSION = "interview-agent-v1";

export function assembleAgentContext(input: {
  language: string;
  persona: string;
  preference: string | null;
  targetRole: string | null;
  resumeOverview: string;
  evidenceDirectory: unknown;
  cacheEpoch: number;
  checkpointSummary: string;
  coverage: unknown;
  recentMessages: Array<{ sequence: number; role: string; kind: string; content: string }>;
  currentInstruction: string;
  runId: string;
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
  input: { interviewId: string; runId: string; currentInstruction: string },
) {
  const [interviewRows, coverage, messages, snapshots] = await Promise.all([
    database.select({
      language: interviews.language,
      persona: interviews.persona,
      preference: interviews.preference,
      targetRole: interviews.targetRole,
      parsedJson: resumeVersions.parsedJson,
      extractedText: resumeVersions.extractedText,
    }).from(interviews)
      .innerJoin(resumeVersions, eq(resumeVersions.id, interviews.resumeVersionId))
      .where(eq(interviews.id, input.interviewId))
      .limit(1),
    database.select({
      category: interviewCoverage.category,
      questionCount: interviewCoverage.questionCount,
      status: interviewCoverage.status,
    }).from(interviewCoverage).where(eq(interviewCoverage.interviewId, input.interviewId)),
    database.select({
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
  ]);
  const interview = interviewRows[0];
  if (!interview) throw new Error("Interview context not found");
  const evidence = indexResumeEvidence(interview.parsedJson, interview.extractedText ?? "");
  const snapshot = snapshots[0];
  return assembleAgentContext({
    language: interview.language,
    persona: interview.persona,
    preference: interview.preference,
    targetRole: interview.targetRole,
    resumeOverview: evidence.overview,
    evidenceDirectory: evidence.directory,
    cacheEpoch: snapshot?.cacheEpoch ?? 0,
    checkpointSummary: snapshot?.summary ?? "",
    coverage,
    recentMessages: messages.reverse().filter(
      (message) => message.sequence > (snapshot?.throughMessageSequence ?? 0),
    ),
    currentInstruction: input.currentInstruction,
    runId: input.runId,
    contextWindow: readPositiveInteger(process.env.INTERVIEW_AGENT_CONTEXT_WINDOW, 128_000),
    outputReserve: readPositiveInteger(process.env.INTERVIEW_AGENT_OUTPUT_RESERVE, 8_000),
  });
}

function readPositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
