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

function fixture(options?: { status?: string; configVersion?: number; scheduleFailures?: number }) {
  const repository = createInMemoryInterviewAgentRepository();
  const calls: string[] = [];
  let rounds = 0;
  const status = options?.status ?? "active";
  const configVersion = options?.configVersion ?? 2;
  let scheduleFailures = options?.scheduleFailures ?? 0;
  const messages = new Map<string, { id: string; runId: string; sequence: number; content: string; created: boolean }>();
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
      const run = await repository.createRun({
        interviewId: input.interviewId,
        idempotencyKey: input.runIdempotencyKey,
      });
      await repository.saveRunTrigger(run.id, input.trigger);
      rounds += 1;
      calls.push("acceptCandidateMessage");
      const message = { id: `message-${messages.size + 1}`, runId: run.id, sequence: messages.size + 1, content: input.content, created: true };
      messages.set(input.idempotencyKey, message);
      return message;
    },
  };
  const scheduler: AgentRunScheduler = {
    async schedule(runId) {
      const run = await repository.getRun(runId);
      calls.push(`run:${run?.trigger?.mode}`);
      if (scheduleFailures > 0) {
        scheduleFailures -= 1;
        throw new Error("simulated scheduler handoff failure");
      }
      await repository.claimRun(runId, `scheduled:${runId}`, new Date(), 30_000);
    },
  };
  return { repository, store, scheduler, calls, getRounds: () => rounds };
}

test("creates an interview, initializes coverage and starts an opening run", async () => {
  const f = fixture();
  const result = await createAgentInterview({
    input: {
      ownerUserId: "user",
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

test("repairs an opening run whose first scheduler handoff failed", async () => {
  const f = fixture({ scheduleFailures: 1 });
  const input = {
    ownerUserId: "user",
    resumeVersionId: "resume-version",
    config: { configVersion: 2 as const, language: "zh" as const, persona: "standard" as const, preference: "", preferenceTags: [] },
    idempotencyKey: "create-repair",
  };
  await assert.rejects(createAgentInterview({
    input,
    store: f.store,
    repository: f.repository,
    scheduler: f.scheduler,
    signal: new AbortController().signal,
  }), /handoff/);
  const repaired = await createAgentInterview({
    input,
    store: f.store,
    repository: f.repository,
    scheduler: f.scheduler,
    signal: new AbortController().signal,
  });
  assert.equal(repaired.runId, "run-1");
  assert.equal(f.calls.filter((call) => call === "run:opening").length, 2);
  assert.equal((await f.repository.getRun(repaired.runId))?.trigger?.mode, "opening");
});

test("repairs an accepted answer without accepting it or incrementing the round again", async () => {
  const f = fixture({ scheduleFailures: 1 });
  const input = { interviewId: "interview", content: "我的回答", idempotencyKey: "answer-repair" };
  await assert.rejects(submitCandidateMessage({
    input,
    store: f.store,
    repository: f.repository,
    scheduler: f.scheduler,
    signal: new AbortController().signal,
  }), /handoff/);
  const repaired = await submitCandidateMessage({
    input,
    store: f.store,
    repository: f.repository,
    scheduler: f.scheduler,
    signal: new AbortController().signal,
  });
  assert.equal(repaired.runId, "run-1");
  assert.equal(f.getRounds(), 1);
  assert.equal(f.calls.filter((call) => call === "acceptCandidateMessage").length, 1);
  assert.equal(f.calls.filter((call) => call === "run:answer").length, 2);
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
  assert.equal(f.repository.inspectInterview("interview").status, "completing");
});

test("ending an interview invalidates an in-flight answer run", async () => {
  const f = fixture();
  const activeRun = await f.repository.createRun({
    interviewId: "interview",
    idempotencyKey: "active-answer",
  });
  await f.repository.saveRunTrigger(activeRun.id, {
    mode: "answer",
    instruction: "continue",
  });
  await f.repository.claimRun(activeRun.id, "worker-a", new Date(0), 30_000);
  await endAgentInterview({
    interviewId: "interview",
    store: f.store,
    repository: f.repository,
  });
  assert.equal((await f.repository.getRun(activeRun.id))?.status, "failed");
  assert.equal(
    (await f.repository.listEvents(activeRun.id, 0)).at(-1)?.type,
    "run_failed",
  );
});
