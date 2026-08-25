import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, inArray } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";
import {
  users,
  resumes,
  resumeVersions,
} from "@/lib/db/schema";

const databaseUrl = process.env.DATABASE_URL;

test("interview retrieval tools enforce database ownership isolation, keyword search, and limit clamping", {
  skip: databaseUrl ? false : "DATABASE_URL is not configured",
}, async () => {
  const [
    { createInterview },
    { submitInterviewAnswer },
    { commitInterviewAgentAction },
    {
      claimInterviewOpeningRun,
      claimInterviewTurnRun,
      loadInterviewResumeEvidence,
      loadInterviewHistoryEntries,
    },
  ] = await Promise.all([
    import("./application/create-interview"),
    import("./application/submit-answer"),
    import("./application/commit-agent-action"),
    import("./persistence/repository"),
  ]);

  const client = postgres(databaseUrl!, { prepare: false });
  const database = drizzle(client, { schema });

  const ownerUserId = randomUUID();
  const foreignUserId = randomUUID();

  try {
    await database.insert(users).values([
      { id: ownerUserId, email: `${ownerUserId}@example.test` },
      { id: foreignUserId, email: `${foreignUserId}@example.test` },
    ]);

    const [resume] = await database.insert(resumes).values({
      userId: ownerUserId,
      title: "Retrieval Test Resume",
    }).returning();

    const [version] = await database.insert(resumeVersions).values({
      resumeId: resume.id,
      versionNumber: 1,
      sourceType: "generated",
      parsedJson: {
        name: "Alex Developer",
        title: "Senior Fullstack Engineer",
        skills: ["React", "TypeScript", "PostgreSQL", "Kafka", "Docker", "Kubernetes", "Redis", "GraphQL", "Rust", "Go", "AWS", "gRPC"],
        experience: [
          {
            title: "Senior Engineer",
            company: "Tech Corp",
            period: "2022-2024",
            bullets: [
              "Architected distributed streaming engine with Kafka and Go",
              "Improved PostgreSQL query throughput by 40% with read replicas",
              "Designed resilient GraphQL gateway handling 50k RPS",
            ],
          },
          {
            title: "Frontend Engineer",
            company: "Web Studio",
            period: "2020-2022",
            bullets: [
              "Built interactive real-time dashboard using React and TailwindCSS",
              "Optimized frontend bundle size with dynamic code splitting",
            ],
          },
        ],
        projects: [
          {
            name: "OpenTelemetry Tracer",
            description: "Distributed tracing library in Rust",
            tags: ["Rust", "Observability"],
          },
        ],
      },
      parseStatus: "parsed",
    }).returning();

    // Create an interview
    const created = await createInterview({
      userId: ownerUserId,
      idempotencyKey: `retrieval-test-${randomUUID()}`,
      request: {
        resumeVersionId: version.id,
        language: "zh",
        persona: "standard",
        interviewType: "technical",
        targetLevel: "Senior",
        targetRole: "Senior Fullstack Engineer",
        preference: "深入分布式系统与性能优化",
        preferenceTags: ["system_design"],
        targetRoundCount: 5,
      },
    }, { database, model: "test/model" });

    const openingClaim = await claimInterviewOpeningRun({
      database,
      userId: ownerUserId,
      openingRunId: created.openingRunId,
      leaseOwner: randomUUID(),
      buildModelMessage: () => ({ role: "user", content: "opening" }),
    });
    assert.equal(openingClaim.state, "claimed");
    if (openingClaim.state !== "claimed") throw new Error("Opening claim failed");

    const evidenceMap = openingClaim.snapshot.evidenceJson as Record<string, { path: string; text: string }>;
    const evidenceIds = Object.keys(evidenceMap);
    assert.ok(evidenceIds.length >= 10, "Expected at least 10 evidence items in parsed resume snapshot");

    // 1. Test loadInterviewResumeEvidence by query
    const queryResult = await loadInterviewResumeEvidence({
      database,
      userId: ownerUserId,
      sessionId: created.agentSessionId,
      interviewId: created.interviewId,
      query: "Kafka",
      limit: 5,
    });
    assert.equal(queryResult.status, "success");
    assert.ok(queryResult.count >= 1);
    assert.ok(queryResult.evidence.some((e) => e.text.includes("Kafka") || e.path.includes("Kafka")));

    // 2. Test loadInterviewResumeEvidence by exact evidenceIds
    const targetIds = evidenceIds.slice(0, 3);
    const idResult = await loadInterviewResumeEvidence({
      database,
      userId: ownerUserId,
      sessionId: created.agentSessionId,
      interviewId: created.interviewId,
      evidenceIds: targetIds,
      limit: 5,
    });
    assert.equal(idResult.status, "success");
    assert.equal(idResult.count, 3);
    assert.deepEqual(idResult.evidence.map((e) => e.id).sort(), targetIds.sort());

    // 3. Test limit clamping (max 10 results even if limit is high)
    const allSkillsResult = await loadInterviewResumeEvidence({
      database,
      userId: ownerUserId,
      sessionId: created.agentSessionId,
      interviewId: created.interviewId,
      query: "skills",
      limit: 20, // Requesting 20
    });
    assert.equal(allSkillsResult.status, "success");
    assert.ok(allSkillsResult.count <= 10, `Expected count <= 10 but got ${allSkillsResult.count}`);

    // 4. Test ownership isolation for evidence: foreign user cannot access
    await assert.rejects(
      loadInterviewResumeEvidence({
        database,
        userId: foreignUserId, // Wrong user
        sessionId: created.agentSessionId,
        interviewId: created.interviewId,
        query: "Kafka",
      }),
      /unauthorized or not found/,
    );

    // 5. Test session mismatch isolation
    await assert.rejects(
      loadInterviewResumeEvidence({
        database,
        userId: ownerUserId,
        sessionId: randomUUID(), // Wrong session
        interviewId: created.interviewId,
        query: "Kafka",
      }),
      /unauthorized or not found/,
    );

    // Commit opening question
    const q1 = await commitInterviewAgentAction({
      userId: ownerUserId,
      sessionId: created.agentSessionId,
      agentRunId: openingClaim.agentRun.id,
      interviewId: created.interviewId,
      interviewRunId: created.openingRunId,
      attemptGeneration: openingClaim.logicalRun.attemptGeneration,
      leaseOwner: openingClaim.logicalRun.leaseOwner!,
      action: {
        answerAnalysis: null,
        action: {
          type: "ask_question",
          kind: "main",
          question: "请详细介绍你在 Tech Corp 使用 Kafka 构建分布式流式引擎的架构设计与高可用保障？",
          topic: "分布式系统",
          resumeEvidenceIds: [evidenceIds[0]],
        },
      },
    }, { database });
    assert.ok("sequence" in q1);
    assert.equal(q1.sequence, 1);
    await database.update(schema.agentRuns).set({ status: "completed", completedAt: new Date() })
      .where(eq(schema.agentRuns.id, openingClaim.agentRun.id));
    await database.update(schema.agentSessions).set({ status: "idle" })
      .where(eq(schema.agentSessions.id, created.agentSessionId));

    // Submit answer 1
    const a1 = await submitInterviewAnswer({
      userId: ownerUserId,
      interviewId: created.interviewId,
      idempotencyKey: `sub-${randomUUID()}`,
      request: {
        questionId: q1.id,
        content: "我们采用了多分区架构和多副本机制，ISR 设置为 3，并在客户端实现了精确一次（EOS）语义。",
        skipped: false,
      },
    }, { database });

    // Claim turn 1
    const turn1Claim = await claimInterviewTurnRun({
      database,
      userId: ownerUserId,
      interviewRunId: a1.run.id,
      leaseOwner: randomUUID(),
      buildModelMessage: () => ({ role: "user", content: "turn-1" }),
    });
    assert.equal(turn1Claim.state, "claimed");
    if (turn1Claim.state !== "claimed") throw new Error("Turn 1 claim failed");

    // Commit question 2 (follow_up)
    const q2 = await commitInterviewAgentAction({
      userId: ownerUserId,
      sessionId: created.agentSessionId,
      agentRunId: turn1Claim.agentRun.id,
      interviewId: created.interviewId,
      interviewRunId: a1.run.id,
      attemptGeneration: turn1Claim.logicalRun.attemptGeneration,
      leaseOwner: turn1Claim.logicalRun.leaseOwner!,
      action: {
        answerAnalysis: {
          completeness: "high",
          specificity: "high",
          evidenceStrength: "high",
          reflectionDepth: "medium",
          followUpNeeded: true,
          missingPoints: [],
          extractedEvidence: ["EOS semantics", "ISR=3"],
        },
        action: {
          type: "ask_question",
          kind: "follow_up",
          question: "在生产网络分区或 Broker 故障时，你们如何处理生产者端重试与消费者再平衡风暴？",
          topic: "分布式系统",
          resumeEvidenceIds: [evidenceIds[0]],
        },
      },
    }, { database });
    assert.ok("sequence" in q2);
    assert.equal(q2.sequence, 2);
    await database.update(schema.agentRuns).set({ status: "completed", completedAt: new Date() })
      .where(eq(schema.agentRuns.id, turn1Claim.agentRun.id));
    await database.update(schema.agentSessions).set({ status: "idle" })
      .where(eq(schema.agentSessions.id, created.agentSessionId));

    // Submit answer 2 (skipped)
    const a2 = await submitInterviewAnswer({
      userId: ownerUserId,
      interviewId: created.interviewId,
      idempotencyKey: `sub-${randomUUID()}`,
      request: {
        questionId: q2.id,
        skipped: true,
      },
    }, { database });
    assert.equal(a2.answer.status, "skipped");

    // Now test loadInterviewHistoryEntries
    // 6. Retrieve history with query filter
    const historyByQuery = await loadInterviewHistoryEntries({
      database,
      userId: ownerUserId,
      sessionId: created.agentSessionId,
      interviewId: created.interviewId,
      query: "精确一次",
    });
    assert.equal(historyByQuery.status, "success");
    assert.equal(historyByQuery.count, 1);
    assert.equal(historyByQuery.history[0].sequence, 1);
    assert.ok(historyByQuery.history[0].answer?.includes("精确一次"));

    // 7. Retrieve history with topic filter
    const historyByTopic = await loadInterviewHistoryEntries({
      database,
      userId: ownerUserId,
      sessionId: created.agentSessionId,
      interviewId: created.interviewId,
      topic: "分布式系统",
    });
    assert.equal(historyByTopic.status, "success");
    assert.equal(historyByTopic.count, 2);
    assert.equal(historyByTopic.history[0].sequence, 1);
    assert.equal(historyByTopic.history[1].sequence, 2);
    assert.equal(historyByTopic.history[1].skipped, true);
    assert.equal(historyByTopic.history[1].answer, null);

    // 8. Retrieve default recent history
    const recentHistory = await loadInterviewHistoryEntries({
      database,
      userId: ownerUserId,
      sessionId: created.agentSessionId,
      interviewId: created.interviewId,
      limit: 1,
    });
    assert.equal(recentHistory.status, "success");
    assert.equal(recentHistory.count, 1);
    assert.equal(recentHistory.history[0].sequence, 2);

    // 9. Current round exclusion via currentInterviewRunId
    // Turn 2 is triggered by a2 (question 2). When querying history for Turn 2, question 2 must be excluded.
    const historyExcludingCurrentTurn = await loadInterviewHistoryEntries({
      database,
      userId: ownerUserId,
      sessionId: created.agentSessionId,
      interviewId: created.interviewId,
      currentInterviewRunId: a2.run.id,
      limit: 5,
    });
    assert.equal(historyExcludingCurrentTurn.status, "success");
    assert.equal(historyExcludingCurrentTurn.count, 1);
    assert.equal(historyExcludingCurrentTurn.history[0].sequence, 1);

    // 10. Ownership isolation for history: foreign user cannot access
    await assert.rejects(
      loadInterviewHistoryEntries({
        database,
        userId: foreignUserId, // Wrong user
        sessionId: created.agentSessionId,
        interviewId: created.interviewId,
      }),
      /unauthorized or not found/,
    );

    // 11. Session mismatch isolation for history
    await assert.rejects(
      loadInterviewHistoryEntries({
        database,
        userId: ownerUserId,
        sessionId: randomUUID(), // Wrong session
        interviewId: created.interviewId,
      }),
      /unauthorized or not found/,
    );

    // 12. Non-interview capability session rejection
    const [workspaceSession] = await database.insert(schema.agentSessions).values({
      userId: ownerUserId,
      title: "Workspace Session",
      model: "test/model",
      capability: "workspace",
      promptVersion: "workspace-agent-v1",
      systemPrompt: "workspace prompt",
      workspaceRoot: "/tmp/fake-workspace",
      status: "idle",
    }).returning();

    // Mismatched capability session rejected for evidence
    await assert.rejects(
      loadInterviewResumeEvidence({
        database,
        userId: ownerUserId,
        sessionId: workspaceSession.id,
        interviewId: created.interviewId,
        query: "Kafka",
      }),
      /unauthorized or not found/,
    );

    // Mismatched capability session rejected for history
    await assert.rejects(
      loadInterviewHistoryEntries({
        database,
        userId: ownerUserId,
        sessionId: workspaceSession.id,
        interviewId: created.interviewId,
      }),
      /unauthorized or not found/,
    );
  } finally {
    const { interviews: interviewsTable, agentSessions: agentSessionsTable } = await import("@/lib/db/schema");
    await database.delete(interviewsTable).where(eq(interviewsTable.userId, ownerUserId));
    await database.delete(agentSessionsTable).where(eq(agentSessionsTable.userId, ownerUserId));
    await database.delete(users).where(inArray(users.id, [ownerUserId, foreignUserId]));
    await client.end();
    const { closeAgentRepositoryConnection } = await import("@/lib/agent/repository");
    await closeAgentRepositoryConnection();
  }
});
