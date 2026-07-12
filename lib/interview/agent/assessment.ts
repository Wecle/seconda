import { generateStructured } from "@/lib/ai/generate-structured";
import { canonicalJson } from "./context/prompt-pipe";
import { answerAssessmentSchema } from "./contracts";

export type AssessmentInput = {
  question: string;
  answer: string;
  category: string;
  topic: string | null;
  coverage: unknown;
  resumeEvidence: unknown;
};

export function buildAnswerAssessmentPrompt(input: AssessmentInput) {
  return {
    system: "你是面试决策辅助器。只判断回答质量和追问价值，不得输出任何0-10分数，不得生成正式点评，不得评价人格，不得虚构简历事实。publicSummary 必须是可向候选人展示的简短过程摘要。",
    prompt: canonicalJson(input),
  };
}

export function assessAnswer(input: AssessmentInput, signal?: AbortSignal) {
  const prompt = buildAnswerAssessmentPrompt(input);
  return generateStructured({
    task: "answer.assess",
    schema: answerAssessmentSchema,
    system: prompt.system,
    prompt: prompt.prompt,
    abortSignal: signal,
  });
}
