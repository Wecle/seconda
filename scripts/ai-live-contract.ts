import { generateText, Output } from "ai";
import { z } from "zod";
import { createProviderModel } from "../lib/ai/provider-registry";
import { loadModelPolicy, resolveModelCandidates, type AITask } from "../lib/ai/model-policy";
import { parsedResumeSchema } from "../lib/resume/types";
import {
  coachEvaluateSchema,
  coachStartSchema,
  followUpRoundSchema,
  generatedQuestionSchema,
  interviewReportSchema,
  scoreResultSchema,
} from "../lib/interview/schemas";

if (process.env.AI_CONTRACT_LIVE !== "1") {
  throw new Error("Set AI_CONTRACT_LIVE=1 to run paid direct-provider contract tests.");
}

const tasks: Array<{ task: AITask; schema: z.ZodType }> = [
  { task: "resume.parse", schema: parsedResumeSchema },
  { task: "question.generate", schema: generatedQuestionSchema },
  { task: "question.follow-up", schema: followUpRoundSchema },
  { task: "answer.score", schema: scoreResultSchema },
  { task: "report.generate", schema: interviewReportSchema },
  { task: "coach.generate", schema: coachStartSchema },
  { task: "coach.evaluate", schema: coachEvaluateSchema },
];

const policy = loadModelPolicy(process.env);
const tested = new Set<string>();

for (const { task, schema } of tasks) {
  for (const candidate of resolveModelCandidates(task, policy).candidates) {
    const testKey = `${candidate.model}:${task}`;
    if (tested.has(testKey)) continue;
    tested.add(testKey);
    const keyName = candidate.credentialTier === "fast" ? "FAST_MODEL_API_KEY" : "QUALITY_MODEL_API_KEY";
    const apiKey = process.env[keyName]?.trim();
    if (!apiKey) throw new Error(`${keyName} must be configured`);
    const provider = createProviderModel({ ...candidate, apiKey });
    const result = await generateText({
      model: provider.model,
      system: provider.metadata.jsonInstruction
        ? `Return only JSON matching the requested schema. ${provider.metadata.jsonInstruction}`
        : "Return only JSON matching the requested schema.",
      prompt: "Use only this synthetic test data: Candidate Example has one software project and no personal contact data.",
      maxRetries: 0,
      output: Output.object({ schema }),
    });
    schema.parse(result.output);
    console.log(`passed ${candidate.model} ${task}`);
  }
}
