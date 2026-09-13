import { useMemo } from "react";
import type { InterviewTranscriptItem, InterviewQuestionView } from "@/lib/interview/projections/types";

export interface ComputeHighlightInput {
  transcript: InterviewTranscriptItem[];
  currentQuestion: InterviewQuestionView | null;
  focusedQuestionId: string | null;
  evidenceJson: Record<string, { path: string; text: string }> | null | undefined;
}

export interface HighlightState {
  persistentEvidenceIds: Set<string>;
  activeEvidenceIds: Set<string>;
  isInheritedFromParent: boolean;
  activeEvidencePaths: Set<string>;
  persistentEvidencePaths: Set<string>;
}

export function computeHighlightState(input: ComputeHighlightInput): HighlightState {
  const { transcript, currentQuestion, focusedQuestionId, evidenceJson } = input;

  const persistentEvidenceIds = new Set<string>();

  const questionsInTranscript = transcript.filter(
    (item): item is Extract<typeof item, { type: "question" }> => item.type === "question",
  );

  for (const q of questionsInTranscript) {
    if (Array.isArray(q.resumeEvidenceIds)) {
      for (const id of q.resumeEvidenceIds) {
        if (id) persistentEvidenceIds.add(id);
      }
    }
  }

  if (currentQuestion && Array.isArray(currentQuestion.resumeEvidenceIds)) {
    for (const id of currentQuestion.resumeEvidenceIds) {
      if (id) persistentEvidenceIds.add(id);
    }
  }

  let activeTarget: {
    id: string;
    kind: "main" | "follow_up";
    resumeEvidenceIds: string[];
    sequence?: number;
  } | null = null;

  if (focusedQuestionId) {
    if (currentQuestion && currentQuestion.id === focusedQuestionId) {
      activeTarget = currentQuestion;
    } else {
      const match = questionsInTranscript.find((q) => q.questionId === focusedQuestionId);
      if (match) {
        activeTarget = {
          id: match.questionId,
          kind: match.kind,
          resumeEvidenceIds: match.resumeEvidenceIds ?? [],
          sequence: match.sequence,
        };
      }
    }
  }

  if (!activeTarget) {
    activeTarget = currentQuestion;
  }

  const activeEvidenceIds = new Set<string>();
  let isInheritedFromParent = false;

  if (activeTarget) {
    if (activeTarget.resumeEvidenceIds && activeTarget.resumeEvidenceIds.length > 0) {
      for (const id of activeTarget.resumeEvidenceIds) {
        activeEvidenceIds.add(id);
      }
    } else if (activeTarget.kind === "follow_up") {
      const targetSeq = activeTarget.sequence ?? Infinity;
      const priorQuestions = questionsInTranscript.filter((q) => q.sequence < targetSeq);
      for (let i = priorQuestions.length - 1; i >= 0; i--) {
        const candidate = priorQuestions[i];
        if (candidate.kind === "main") {
          if (candidate.resumeEvidenceIds && candidate.resumeEvidenceIds.length > 0) {
            for (const id of candidate.resumeEvidenceIds) {
              activeEvidenceIds.add(id);
            }
            isInheritedFromParent = true;
          }
          break;
        }
      }
    }
  }

  const activeEvidencePaths = new Set<string>();
  const persistentEvidencePaths = new Set<string>();

  if (evidenceJson) {
    for (const id of activeEvidenceIds) {
      const entry = evidenceJson[id];
      if (entry?.path) activeEvidencePaths.add(entry.path);
    }
    for (const id of persistentEvidenceIds) {
      const entry = evidenceJson[id];
      if (entry?.path) persistentEvidencePaths.add(entry.path);
    }
  }

  return {
    persistentEvidenceIds,
    activeEvidenceIds,
    isInheritedFromParent,
    activeEvidencePaths,
    persistentEvidencePaths,
  };
}

export function useInterviewResumeHighlight({
  transcript,
  currentQuestion,
  focusedQuestionId,
  evidenceJson,
}: ComputeHighlightInput): HighlightState {
  return useMemo(
    () =>
      computeHighlightState({
        transcript,
        currentQuestion,
        focusedQuestionId,
        evidenceJson,
      }),
    [transcript, currentQuestion, focusedQuestionId, evidenceJson],
  );
}
