import assert from "node:assert/strict";
import test from "node:test";
import { createInMemoryInterviewAgentRepository } from "./repository";
import {
  createAgentInterview,
  endAgentInterview,
  submitCandidateMessage,
  type AgentInterviewStore,
  type AgentRunScheduler,
} from "./service";

function fixture(options?: { status?: string; configVersion?: number }) {
  const repository = createInMemoryInterviewAgentRepository();
  const calls: string[] = [];
  let rounds = 0;
  let status = options?.status ?? "active";
  const configVersion = options?.configVersion ?? 2;
  const messages = new Map<string, { id: string; sequence: number; content: string; created: boolean }>();
  const store: AgentInterviewStore = {
    async createInterview() {
      calls.push("createInterview");
      return { interviewId: "interview", resumeSummary: "Seconda 前端工程师项目" };
    },
    async initializeCoverage() { calls.push("initializeCoverage"); },
    async loadInterview() { return { id: "interview", status, configVersion, candidateRoundCount: rounds }; },
    async acceptCandidateMessage(input) {
      const existing = messages.get(input.idempotencyKey);
      if (existing) return { ...existing, created: false };
      rounds += 1;
      calls.push("acceptCandidateMessage");
      const message = { id: `message-${messages.size + 1}`, sequence: messages.size + 1, content: input.content, created: true };
      messages.set(input.idempotencyKey, message);
      return message;
    },
    async markCompleting() { status = "completing"; calls.push("markCompleting"); return true; },
  };
  const scheduler: AgentRunScheduler = {
    async schedule(runId) {
      const run = await repository.getRun(runId);
      calls.push(`run:${run?.trigger?.mode}`);
    },
  };
  return { repository, store, scheduler, calls, getRounds: () => rounds };
}

test("creates an interview, initializes coverage and starts an opening run", async () => {
  const f = fixture();
  const result = await createAgentInterview({
    input: {
      resumeVersionId: "resume-version",
      config: { configVersion: 2, language: "zh", persona: "standard", preference: "项目深挖", preferenceTags: ["project_deep_dive"] },
      idempotencyKey: "create-key",
    },
    store: f.store,
    repository: f.repository,
    scheduler: f.scheduler,
    signal: new AbortController().signal,
  });
  assert.equal(result.interviewId, "interview");
  assert.deepEqual(f.calls, ["createInterview", "initializeCoverage", "run:opening"]);
});

test("accepts a candidate answer exactly once for a repeated idempotency key", async () => {
  const f = fixture();
  const input = { interviewId: "interview", content: "我的回答", idempotencyKey: "message-key" };
  const first = await submitCandidateMessage({ input, store: f.store, repository: f.repository, scheduler: f.scheduler, signal: new AbortController().signal });
  const second = await submitCandidateMessage({ input, store: f.store, repository: f.repository, scheduler: f.scheduler, signal: new AbortController().signal });
  assert.equal(first.runId, second.runId);
  assert.deepEqual(first.message, second.message);
  assert.equal(f.getRounds(), 1);
  assert.equal(f.calls.filter((call) => call === "run:answer").length, 1);
});

test("rejects inactive and legacy interviews", async () => {
  for (const f of [fixture({ status: "completed" }), fixture({ configVersion: 1 })]) {
    await assert.rejects(
      submitCandidateMessage({
        input: { interviewId: "interview", content: "answer", idempotencyKey: "key" },
        store: f.store,
        repository: f.repository,
        scheduler: f.scheduler,
        signal: new AbortController().signal,
      }),
      /not an active v2 interview/,
    );
  }
});

test("ends without another model call and is idempotent", async () => {
  const f = fixture();
  const first = await endAgentInterview({ interviewId: "interview", store: f.store, repository: f.repository });
  const second = await endAgentInterview({ interviewId: "interview", store: f.store, repository: f.repository });
  assert.equal(first.status, "completing");
  assert.equal(second.status, "completing");
  assert.equal(f.calls.some((call) => call.startsWith("run:")), false);
  assert.equal(f.calls.filter((call) => call === "markCompleting").length, 1);
});
