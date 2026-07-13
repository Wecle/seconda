import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../lib/db";
import {
  interviewAgentRuns,
  interviewCoverage,
  interviewMessages,
  interviews,
  resumes,
  resumeVersions,
} from "../lib/db/schema";
import { createProductionAgentDependencies } from "../lib/interview/agent/composition";
import { createDrizzleAgentInterviewStore } from "../lib/interview/agent/drizzle-store";
import {
  createAgentInterview,
  endAgentInterview,
  submitCandidateMessage,
} from "../lib/interview/agent/service";
import { executeClaimedRun } from "../lib/interview/agent/worker";
import {
  messageCommittedPayloadSchema,
  reasoningDeltaPayloadSchema,
  responseDeltaPayloadSchema,
} from "../lib/interview/agent/contracts";

async function main() {
  const resumeVersionId = process.env.INTERVIEW_AGENT_TEST_RESUME_VERSION_ID?.trim();
  assert.ok(resumeVersionId, "INTERVIEW_AGENT_TEST_RESUME_VERSION_ID must be configured");
  const [resume] = await db.select({ id: resumeVersions.id, status: resumeVersions.parseStatus, userId: resumes.userId })
    .from(resumeVersions)
    .innerJoin(resumes, eq(resumes.id, resumeVersions.resumeId))
    .where(eq(resumeVersions.id, resumeVersionId))
    .limit(1);
  assert.equal(resume?.status, "parsed", "test resume must exist and be parsed");
  assert.ok(resume.userId, "test resume must have an owner");

  const dependencies = createProductionAgentDependencies();
  const store = createDrizzleAgentInterviewStore(db);
  const scheduler = {
    async schedule(runId: string) {
      await executeClaimedRun({
        runId,
        owner: `contract:${randomUUID()}`,
        repository: dependencies.repository,
        executor: dependencies.executor,
      });
    },
  };
  const created = await createAgentInterview({
    input: {
      ownerUserId: resume.userId,
      resumeVersionId,
      config: {
        configVersion: 2,
        language: "zh",
        persona: "standard",
        preference: "重点深挖项目中的技术判断",
        preferenceTags: ["project_deep_dive"],
      },
      idempotencyKey: `contract:create:${randomUUID()}`,
    },
    store,
    repository: dependencies.repository,
    scheduler,
    signal: new AbortController().signal,
  });

  const openingMessages = await db.select({ kind: interviewMessages.kind })
    .from(interviewMessages)
    .where(eq(interviewMessages.interviewId, created.interviewId));
  assert.ok(openingMessages.some((message) => message.kind === "question"), "opening question must be committed");

  for (const content of [
    "我主要负责 Seconda 的前端和 AI 面试流程设计，重点解决可靠性与上下文管理。",
    "我会先用指标定位瓶颈，再通过稳定 Prompt 前缀和低频压缩控制成本。",
  ]) {
    await submitCandidateMessage({
      input: { interviewId: created.interviewId, content, idempotencyKey: randomUUID() },
      store,
      repository: dependencies.repository,
      scheduler,
      signal: new AbortController().signal,
    });
  }

  await endAgentInterview({
    interviewId: created.interviewId,
    store,
    repository: dependencies.repository,
  });

  const [interview] = await db.select({ rounds: interviews.candidateRoundCount, status: interviews.status })
    .from(interviews)
    .where(eq(interviews.id, created.interviewId));
  assert.equal(interview.rounds, 2);
  assert.equal(interview.status, "completing");

  const coverage = await db.select({ category: interviewCoverage.category, count: interviewCoverage.questionCount })
    .from(interviewCoverage)
    .where(eq(interviewCoverage.interviewId, created.interviewId));
  assert.ok(coverage.every((item) => item.count <= 3), "category count exceeded 3");

  const [lastRun] = await db.select({
    id: interviewAgentRuns.id,
    exitReason: interviewAgentRuns.exitReason,
  })
    .from(interviewAgentRuns)
    .where(and(
      eq(interviewAgentRuns.interviewId, created.interviewId),
      eq(interviewAgentRuns.status, "completed"),
    ))
    .orderBy(desc(interviewAgentRuns.createdAt))
    .limit(1);
  assert.ok(lastRun, "a completed Agent run must exist");
  const publicEvents = await dependencies.repository.listEvents(lastRun.id, 0, {
    visibility: "public",
  });
  const publicTypes = publicEvents.map((event) => event.type);
  const orderedTypes = [
    "reasoning_delta",
    "proposal_authorized",
    "response_started",
    "response_delta",
    "message_committed",
  ] as const;
  let previousIndex = -1;
  let previousType: typeof orderedTypes[number] | null = null;
  for (const type of orderedTypes) {
    const index = publicTypes.indexOf(type);
    assert.ok(index >= 0, `${type} must be public`);
    if (previousType) assert.ok(index > previousIndex, `${type} must follow ${previousType}`);
    previousIndex = index;
    previousType = type;
  }
  assert.equal(publicTypes.includes("text_delta"), false, "legacy synthetic text_delta must not be public");
  assert.equal(publicTypes.filter((type) => type === "message_committed").length, 1);
  assert.equal(new Set(publicEvents.map((event) => event.sequence)).size, publicEvents.length);

  const committedEvent = publicEvents.find((event) => event.type === "message_committed");
  assert.ok(committedEvent, "the authoritative commit event must exist");
  const committedPayload = messageCommittedPayloadSchema.parse(committedEvent.payload);
  const committedResponseDeltas = publicEvents
    .filter((event) => event.type === "response_delta")
    .map((event) => responseDeltaPayloadSchema.parse(event.payload))
    .filter((payload) => (
      payload.attemptId === committedPayload.attemptId
      && payload.logicalMessageId === committedPayload.logicalMessageId
    ));
  assert.ok(committedResponseDeltas.length > 0, "the committed attempt must stream at least one response delta");
  assert.equal(
    committedResponseDeltas.map((payload) => payload.text).join(""),
    committedPayload.message.content,
    "the authoritative response must equal its persisted response deltas",
  );
  const committedReasoning = publicEvents
    .filter((event) => event.type === "reasoning_delta")
    .map((event) => reasoningDeltaPayloadSchema.parse(event.payload))
    .some((payload) => payload.attemptId === committedPayload.attemptId);
  assert.equal(committedReasoning, true, "the committed attempt must expose durable public reasoning");

  const completedRuns = await db.select({
    id: interviewAgentRuns.id,
    checkpoint: interviewAgentRuns.checkpointJson,
  }).from(interviewAgentRuns).where(and(
    eq(interviewAgentRuns.interviewId, created.interviewId),
    eq(interviewAgentRuns.status, "completed"),
  ));
  let controlledNoToolRun = false;
  for (const completedRun of completedRuns) {
    const events = await dependencies.repository.listEvents(completedRun.id, 0, {
      visibility: "public",
    });
    const checkpoint = completedRun.checkpoint as { modelCallCount?: number } | null;
    if (
      checkpoint?.modelCallCount === 1
      && !events.some((event) => event.type === "tool_call_started")
    ) {
      controlledNoToolRun = true;
      break;
    }
  }
  assert.equal(
    controlledNoToolRun,
    true,
    "at least one controlled no-read-tool turn must complete in exactly one model call",
  );
  const allEvents = await dependencies.repository.listEvents(lastRun.id, 0);
  const cursor = allEvents.length > 1 ? allEvents.at(-2)!.sequence : 0;
  const replayed = await dependencies.repository.listEvents(lastRun.id, cursor);
  assert.ok(replayed.every((event) => event.sequence > cursor), "event replay cursor must be exclusive");
  assert.equal(new Set(replayed.map((event) => event.sequence)).size, replayed.length, "replayed events must not duplicate sequences");
  const persistedRun = await dependencies.repository.getRun(lastRun.id);
  assert.ok(
    persistedRun?.status !== "running" ||
      Boolean(persistedRun.leaseExpiresAt && persistedRun.leaseExpiresAt.getTime() > Date.now()),
    "running Agent run must hold an unexpired lease",
  );
  process.stdout.write(`${JSON.stringify({ interviewId: created.interviewId, runId: lastRun.id, exitReason: lastRun.exitReason })}\n`);
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
