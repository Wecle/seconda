import assert from "node:assert/strict";
import test from "node:test";
import { createInMemoryInterviewAgentRepository } from "@/lib/interview/agent/persistence/memory-repository";
import {
  createAgentInterview,
  endAgentInterview,
  retryFailedAgentRun,
  submitCandidateMessage,
} from "@/lib/interview/agent/application/interview-service";
import type {
  AgentRunScheduler,
} from "@/lib/interview/agent/application/ports";
import type { AgentInterviewStore } from "@/lib/interview/agent/persistence/interview-store";

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
      rounds += 1;
      calls.push("acceptCandidateMessage");
      const message = { id: `message-${messages.size + 1}`, runId: run.id, sequence: messages.size + 1, content: input.content, created: true };
      await repository.saveRunTrigger(run.id, {
        ...input.trigger,
        mode: "answer",
        answerMessageId: message.id,
      });
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

async function terminallyFailRun(
  repository: ReturnType<typeof createInMemoryInterviewAgentRepository>,
  input: { interviewId?: string; key: string; mode: "opening" | "answer" },
) {
  const interviewId = input.interviewId ?? "interview";
  const run = await repository.createRun({
    interviewId,
    idempotencyKey: input.key,
  });
  let answerMessageId: string | null = null;
  if (input.mode === "answer") {
    const answer = await repository.appendMessage({
      interviewId,
      runId: run.id,
      role: "user",
      kind: "answer",
      content: "candidate answer",
    });
    answerMessageId = answer.id;
  }
  await repository.saveRunTrigger(run.id, input.mode === "opening"
    ? { mode: "opening", instruction: "opening instruction" }
    : {
        mode: "answer",
        instruction: "answer instruction",
        answerMessageId: answerMessageId!,
      });
  await repository.failRun(
    run.id,
    "terminal_action_failed",
    new Error("invalid action"),
  );
  return run.id;
}

async function expectRetryCode(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (error: unknown) => (
    typeof error === "object" && error !== null
    && "code" in error && error.code === code
  ));
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
  const instruction = (await f.repository.getRun(result.runId))?.trigger?.instruction ?? "";
  assert.match(instruction, /submit_interview_turn/);
  assert.match(instruction, /clarify/);
  assert.doesNotMatch(instruction, /ask_interview_question|持久化 inferred targetRole/);
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

test("retries the latest terminal failure with one replacement run", async () => {
  const f = fixture();
  const failedRunId = await terminallyFailRun(f.repository, {
    key: "failed",
    mode: "opening",
  });

  const first = await retryFailedAgentRun({
    interviewId: "interview",
    failedRunId,
    repository: f.repository,
    scheduler: f.scheduler,
    now: new Date(),
  });
  const second = await retryFailedAgentRun({
    interviewId: "interview",
    failedRunId,
    repository: f.repository,
    scheduler: f.scheduler,
    now: new Date(),
  });

  assert.equal(first.runId, second.runId);
  assert.notEqual(first.runId, failedRunId);
  assert.deepEqual((await f.repository.getRun(first.runId))?.trigger, {
    mode: "opening",
    instruction: "opening instruction",
  });
  assert.equal(f.calls.filter((call) => call === "run:opening").length, 1);
});

test("concurrent retries observe one fully initialized replacement", async () => {
  const f = fixture();
  const failedRunId = await terminallyFailRun(f.repository, {
    key: "concurrent-failed",
    mode: "opening",
  });

  const results = await Promise.all(Array.from({ length: 4 }, () => retryFailedAgentRun({
    interviewId: "interview",
    failedRunId,
    repository: f.repository,
    scheduler: f.scheduler,
    now: new Date(),
  })));

  assert.equal(new Set(results.map((result) => result.runId)).size, 1);
  const replacement = await f.repository.getRun(results[0].runId);
  assert.deepEqual(replacement?.trigger, {
    mode: "opening",
    instruction: "opening instruction",
  });
});

test("does not create a replacement after the interview starts completing", async () => {
  const f = fixture();
  const failedRunId = await terminallyFailRun(f.repository, {
    key: "inactive-failed",
    mode: "opening",
  });
  await f.repository.markInterviewCompleting("interview");

  await expectRetryCode(retryFailedAgentRun({
    interviewId: "interview",
    failedRunId,
    repository: f.repository,
    scheduler: f.scheduler,
    now: new Date(),
  }), "RETRY_RUN_NOT_REPLACEABLE");
});

test("preserves the original answer message without creating another", async () => {
  const f = fixture();
  const failedRunId = await terminallyFailRun(f.repository, {
    key: "answer-failed",
    mode: "answer",
  });
  const beforeMessages = f.repository.inspectInterview("interview").messages;
  const originalAnswer = beforeMessages.find((message) => message.runId === failedRunId);
  assert.ok(originalAnswer);

  const retried = await retryFailedAgentRun({
    interviewId: "interview",
    failedRunId,
    repository: f.repository,
    scheduler: f.scheduler,
    now: new Date(),
  });

  assert.equal(
    f.repository.inspectInterview("interview").messages.length,
    beforeMessages.length,
  );
  const trigger = (await f.repository.getRun(retried.runId))?.trigger;
  assert.equal(trigger?.mode, "answer");
  assert.equal(
    trigger?.mode === "answer" ? trigger.answerMessageId : null,
    originalAnswer.id,
  );
});

test("rejects a stale failed run when no replacement exists", async () => {
  const f = fixture();
  const failedRunId = await terminallyFailRun(f.repository, {
    key: "old-failed",
    mode: "opening",
  });
  await f.repository.createRun({
    interviewId: "interview",
    idempotencyKey: "newer",
  });

  await expectRetryCode(retryFailedAgentRun({
    interviewId: "interview",
    failedRunId,
    repository: f.repository,
    scheduler: f.scheduler,
    now: new Date(),
  }), "RETRY_RUN_STALE");
});

test("retry rejects unsafe source runs with stable codes", async () => {
  const f = fixture();

  const running = await f.repository.createRun({
    interviewId: "interview",
    idempotencyKey: "running",
  });
  await f.repository.saveRunTrigger(running.id, {
    mode: "opening",
    instruction: "open",
  });
  await expectRetryCode(retryFailedAgentRun({
    interviewId: "interview",
    failedRunId: running.id,
    repository: f.repository,
    scheduler: f.scheduler,
    now: new Date(),
  }), "RETRY_RUN_NOT_FAILED");

  const completed = await f.repository.createRun({
    interviewId: "interview",
    idempotencyKey: "completed",
  });
  await f.repository.saveRunTrigger(completed.id, {
    mode: "opening",
    instruction: "open",
  });
  await f.repository.completeRun(completed.id, "completed");
  await expectRetryCode(retryFailedAgentRun({
    interviewId: "interview",
    failedRunId: completed.id,
    repository: f.repository,
    scheduler: f.scheduler,
    now: new Date(),
  }), "RETRY_RUN_NOT_FAILED");

  const resumable = await f.repository.createRun({
    interviewId: "interview",
    idempotencyKey: "resumable",
  });
  await f.repository.saveRunTrigger(resumable.id, {
    mode: "opening",
    instruction: "open",
  });
  await f.repository.failRun(
    resumable.id,
    "provider_failed",
    new Error("provider"),
  );
  await expectRetryCode(retryFailedAgentRun({
    interviewId: "interview",
    failedRunId: resumable.id,
    repository: f.repository,
    scheduler: f.scheduler,
    now: new Date(),
  }), "RETRY_RUN_NOT_REPLACEABLE");

  const triggerless = await f.repository.createRun({
    interviewId: "interview",
    idempotencyKey: "triggerless",
  });
  await f.repository.failRun(
    triggerless.id,
    "terminal_action_failed",
    new Error("invalid"),
  );
  await expectRetryCode(retryFailedAgentRun({
    interviewId: "interview",
    failedRunId: triggerless.id,
    repository: f.repository,
    scheduler: f.scheduler,
    now: new Date(),
  }), "RETRY_RUN_TRIGGER_MISSING");

  const foreign = await terminallyFailRun(f.repository, {
    interviewId: "another-interview",
    key: "foreign",
    mode: "opening",
  });
  await expectRetryCode(retryFailedAgentRun({
    interviewId: "interview",
    failedRunId: foreign,
    repository: f.repository,
    scheduler: f.scheduler,
    now: new Date(),
  }), "RETRY_RUN_NOT_FOUND");

  await expectRetryCode(retryFailedAgentRun({
    interviewId: "interview",
    failedRunId: "missing",
    repository: f.repository,
    scheduler: f.scheduler,
    now: new Date(),
  }), "RETRY_RUN_NOT_FOUND");
});

test("rejects inactive interviews", async () => {
  const f = fixture({ status: "completed" });
  await assert.rejects(
    submitCandidateMessage({
      input: { interviewId: "interview", content: "answer", idempotencyKey: "key" },
      store: f.store,
      repository: f.repository,
      scheduler: f.scheduler,
      signal: new AbortController().signal,
    }),
    /not active/,
  );
});

test("active historical config uses the latest runtime", async () => {
  const f = fixture({ configVersion: 1 });
  const result = await submitCandidateMessage({
    input: { interviewId: "interview", content: "answer", idempotencyKey: "key" },
    store: f.store,
    repository: f.repository,
    scheduler: f.scheduler,
    signal: new AbortController().signal,
  });
  assert.equal(result.status, "accepted");
  assert.deepEqual(f.calls.slice(-2), ["acceptCandidateMessage", "run:answer"]);
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
    answerMessageId: "answer-message-1",
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
