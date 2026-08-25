import type { ModelMessage } from "ai";
import type { ContextProvider } from "@/lib/agent/types";
import type { ResumeEvidenceMap } from "../domain/create-interview";
import { projectInterviewRunModelMessage } from "../projections/model";

export function createInterviewContextProviders(systemPrompt: string): ContextProvider[] {
  return [{
    id: "interview-contract",
    order: 10,
    provide: () => ({
      id: "interview-contract",
      order: 10,
      title: "Interview contract",
      content: systemPrompt,
      trust: "trusted-instruction",
    }),
  }];
}

export function buildOpeningModelMessage(input: {
  language: "zh" | "en" | "es" | "de";
  persona: "friendly" | "standard" | "stressful";
  interviewType: "behavioral" | "technical" | "mixed";
  targetLevel: "Junior" | "Mid" | "Senior";
  targetRole: string;
  preference: string;
  preferenceTags: string[];
  targetRoundCount: number;
  canonicalResume: string;
  resumeEvidence: ResumeEvidenceMap;
}): ModelMessage {
  return projectInterviewRunModelMessage({
    trigger: "opening",
    targetLevel: input.targetLevel,
    interviewType: input.interviewType,
    language: input.language,
    persona: input.persona,
    remainingRounds: input.targetRoundCount,
    targetRoundCount: input.targetRoundCount,
    answeredRoundCount: 0,
    targetRole: input.targetRole,
    preference: input.preference,
    preferenceTags: input.preferenceTags,
    canonicalResume: input.canonicalResume,
    resumeEvidence: input.resumeEvidence,
    currentQuestion: null,
    currentAnswer: null,
    history: [],
    coveredTopics: [],
  });
}
