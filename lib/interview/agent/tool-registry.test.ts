import assert from "node:assert/strict";
import test from "node:test";
import { createInMemoryInterviewAgentRepository } from "./repository";
import { createInterviewToolRegistry } from "./tool-registry";

test("rejects another question when deterministic policy requires completion", async () => {
  const repository = createInMemoryInterviewAgentRepository();
  const run = await repository.createRun({ interviewId: "interview", idempotencyKey: "run" });
  const registry = createInterviewToolRegistry({
    handlers: Object.fromEntries([
      "get_resume_evidence", "get_interview_history", "get_coverage_state",
      "record_answer_evaluation", "update_coverage", "ask_interview_question",
      "finish_interview",
    ].map((name) => [name, async () => ({})])) as never,
    async loadActionInput(input) {
      return {
        candidateRoundCount: 20,
        categoryCounts: {},
        recentQuestions: [],
        requestedUserEnd: false,
        proposal: {
          action: input.action,
          category: input.category,
          intent: input.intent,
          question: input.question,
          resumeEvidenceIds: input.resumeEvidenceIds,
        },
      };
    },
  });
  const definition = registry.get("ask_interview_question")!;
  const parsed = definition.inputSchema.parse({
    action: "ask",
    category: "technical_depth",
    intent: "follow_up",
    question: "继续追问？",
    topic: "缓存",
    resumeEvidenceIds: ["resume:structured"],
  });
  const error = await definition.validateBusiness(parsed, {
    interviewId: "interview",
    runId: run.id,
    repository,
  });
  assert.equal(error?.code, "INTERVIEW_MUST_FINISH");
});

test("requires a complete bounded six-dimension evaluation", () => {
  const registry = createInterviewToolRegistry({
    handlers: {} as never,
    async loadActionInput() { throw new Error("not used"); },
  });
  const schema = registry.get("record_answer_evaluation")!.inputSchema;
  assert.equal(schema.safeParse({ evaluation: { scores: { overall: 10 } } }).success, false);
  assert.equal(schema.safeParse({
    evaluation: {
      scores: { understanding: 8, expression: 8, logic: 8, depth: 7, authenticity: 9, reflection: 7, overall: 8 },
      strengths: ["清晰"], improvements: ["补充量化结果"], advice: ["使用 STAR"],
      deepDive: { coreConcepts: { items: [] }, pitfalls: [], modelAnswer: { steps: [] } },
    },
  }).success, true);
});
