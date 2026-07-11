import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../lib/db";
import {
  interviewAgentRuns,
  interviewCoverage,
  interviewMessages,
  interviews,
  resumeVersions,
} from "../lib/db/schema";
import { createProductionAgentDependencies } from "../lib/interview/agent/composition";
import { createDrizzleAgentInterviewStore } from "../lib/interview/agent/drizzle-store";
import {
  createAgentInterview,
  endAgentInterview,
  submitCandidateMessage,
} from "../lib/interview/agent/service";

async function main() {
  const resumeVersionId = process.env.INTERVIEW_AGENT_TEST_RESUME_VERSION_ID?.trim();
  assert.ok(resumeVersionId, "INTERVIEW_AGENT_TEST_RESUME_VERSION_ID must be configured");
  const [resume] = await db.select({ id: resumeVersions.id, status: resumeVersions.parseStatus })
    .from(resumeVersions)
    .where(eq(resumeVersions.id, resumeVersionId))
    .limit(1);
  assert.equal(resume?.status, "parsed", "test resume must exist and be parsed");

  const dependencies = createProductionAgentDependencies();
  const store = createDrizzleAgentInterviewStore(db);
  const created = await createAgentInterview({
    input: {
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
    executor: dependencies.executor,
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
      executor: dependencies.executor,
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

  const [lastRun] = await db.select({ id: interviewAgentRuns.id, exitReason: interviewAgentRuns.exitReason })
    .from(interviewAgentRuns)
    .where(and(
      eq(interviewAgentRuns.interviewId, created.interviewId),
      eq(interviewAgentRuns.status, "completed"),
    ))
    .orderBy(desc(interviewAgentRuns.createdAt))
    .limit(1);
  assert.ok(lastRun, "a completed Agent run must exist");
  process.stdout.write(`${JSON.stringify({ interviewId: created.interviewId, runId: lastRun.id, exitReason: lastRun.exitReason })}\n`);
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
