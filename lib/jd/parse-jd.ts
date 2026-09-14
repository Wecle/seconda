import { generateStructured } from "@/lib/ai/generate-structured";
import type { AITaskTelemetryContext } from "@/lib/ai/telemetry/types";
import { parsedJobDescriptionSchema, type ParsedJobDescription } from "./types";
import { buildJdParsingPrompt, JD_PARSING_SYSTEM_PROMPT } from "./prompt";

export async function parseJobDescription(
  rawText: string,
  telemetry?: AITaskTelemetryContext,
): Promise<ParsedJobDescription> {
  try {
    const result = await generateStructured({
      task: "jd.parse",
      schema: parsedJobDescriptionSchema,
      system: JD_PARSING_SYSTEM_PROMPT,
      prompt: buildJdParsingPrompt(rawText),
      telemetry,
    });
    return result;
  } catch {
    const firstLine = rawText.split("\n").map((line) => line.trim()).filter(Boolean)[0] ?? "";
    const fallbackTitle = firstLine.slice(0, 50) || "目标岗位";
    return {
      roleTitle: fallbackTitle,
      experienceLevel: "Mid",
      coreResponsibilities: ["负责岗位日常核心业务落地与技术开发"],
      mustHaveSkills: ["具备扎实的专业基础与实战落地能力"],
      niceToHaveSkills: [],
      competencyKeywords: [fallbackTitle],
      decodingInsights: {
        verbAutonomyLevel: "execute",
        betweenTheLines: ["按照团队标准高质量交付业务目标"],
        reverseQuestions: ["团队当前的重点攻坚方向是什么？"],
      },
    };
  }
}
