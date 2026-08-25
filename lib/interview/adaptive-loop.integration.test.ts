import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";
import {
  agentEvents,
  agentRuns,
  agentSessions,
  interviewAnswers,
  interviewQuestions,
  interviews,
  resumes,
  resumeVersions,
  users,
} from "@/lib/db/schema";

const databaseUrl = process.env.DATABASE_URL;

test("adaptive interview loop is idempotent and enforces analysis, follow-up, rounds, skip, and early completion", {
  skip: databaseUrl ? false : "DATABASE_URL is not configured",
}, async () => {
  const [
    { createInterview },
    { submitInterviewAnswer },
    { requestInterviewCompletion },
    { commitInterviewAgentAction },
    { claimInterviewOpeningRun, claimInterviewTurnRun },
  ] = await Promise.all([
    import("./application/create-interview"),
    import("./application/submit-answer"),
    import("./application/request-completion"),
    import("./application/commit-agent-action"),
    import("./persistence/repository"),
  ]);
  const client = postgres(databaseUrl!, { prepare: false });
  const database = drizzle(client, { schema });
  const userId = randomUUID();
  const foreignUserId = randomUUID();
  await database.insert(users).values([
    { id: userId, email: `${userId}@example.test` },
    { id: foreignUserId, email: `${foreignUserId}@example.test` },
  ]);
  const [resume] = await database.insert(resumes).values({ userId, title: "Adaptive Resume" }).returning();
  const [version] = await database.insert(resumeVersions).values({
    resumeId: resume.id,
    versionNumber: 1,
    sourceType: "generated",
    parsedJson: {
      name: "Candidate",
      title: "Platform Engineer",
      skills: ["TypeScript"],
      experience: [{
        title: "Engineer",
        company: "Seconda",
        period: "2024-present",
        bullets: ["Built an event-driven Agent runtime"],
      }],
    },
    parseStatus: "parsed",
  }).returning();

  const create = (key: string, targetRoundCount: number) => createInterview({
    userId,
    idempotencyKey: key,
    request: {
      resumeVersionId: version.id,
      language: "zh",
      persona: "standard",
      interviewType: "mixed",
      targetLevel: "Senior",
      targetRole: "Platform Engineer",
      preference: "深入项目",
      preferenceTags: ["project_deep_dive"],
      targetRoundCount,
    },
  }, { database, model: "test/model" });

  async function open(created: Awaited<ReturnType<typeof createInterview>>, questionText: string) {
    const claim = await claimInterviewOpeningRun({
      database,
      userId,
      openingRunId: created.openingRunId,
      buildModelMessage: () => ({ role: "user", content: "opening" }),
    });
    assert.equal(claim.state, "claimed");
    if (claim.state !== "claimed") throw new Error("Opening was not claimed");
    const evidenceId = Object.keys(claim.snapshot.evidenceJson as object)[0];
    const question = await commitInterviewAgentAction({
      userId,
      sessionId: claim.session.id,
      agentRunId: claim.agentRun.id,
      interviewId: claim.interview.id,
      interviewRunId: claim.logicalRun.id,
      attemptGeneration: claim.logicalRun.attemptGeneration,
      action: {
        answerAnalysis: null,
        action: {
          type: "ask_question",
          kind: "main",
          question: questionText,
          topic: "系统设计",
          resumeEvidenceIds: [evidenceId],
        },
      },
    }, { database });
    await database.update(agentRuns).set({ status: "completed", completedAt: new Date() })
      .where(eq(agentRuns.id, claim.agentRun.id));
    await database.update(agentSessions).set({ status: "idle" })
      .where(eq(agentSessions.id, claim.session.id));
    return { question, evidenceId };
  }

  try {
    const created = await create("adaptive-loop", 2);
    const opening = await open(created, "请介绍事件驱动 Agent Runtime 的核心设计。");
    const request = {
      questionId: opening.question.id,
      content: "我使用事件日志分离模型输出与领域事实，并通过事务保证提交一致性。",
      skipped: false,
    };
    const submissions = await Promise.all([
      submitInterviewAnswer({ userId, interviewId: created.interviewId, idempotencyKey: "answer-1", request }, { database }),
      submitInterviewAnswer({ userId, interviewId: created.interviewId, idempotencyKey: "answer-1", request }, { database }),
    ]);
    assert.equal(submissions[0].answer.id, submissions[1].answer.id);
    assert.equal(submissions.filter(({ replayed }) => replayed).length, 1);
    await assert.rejects(submitInterviewAnswer({
      userId,
      interviewId: created.interviewId,
      idempotencyKey: "answer-1",
      request: { ...request, content: "different" },
    }, { database }), /idempotency key/);

    await database.update(interviewQuestions).set({ status: "awaiting_answer", closedAt: null })
      .where(eq(interviewQuestions.id, opening.question.id));
    await assert.rejects(submitInterviewAnswer({
      userId,
      interviewId: created.interviewId,
      idempotencyKey: "answer-while-queued",
      request: { ...request, content: "queued conflict" },
    }, { database }), /already evaluating/);
    await database.update(interviewQuestions).set({ status: "answered", closedAt: new Date() })
      .where(eq(interviewQuestions.id, opening.question.id));

    const firstTurn = await claimInterviewTurnRun({
      database,
      userId,
      interviewRunId: submissions[0].run.id,
      buildModelMessage: () => ({ role: "user", content: "answer turn" }),
    });
    assert.equal(firstTurn.state, "claimed");
    if (firstTurn.state !== "claimed") throw new Error("Answer turn was not claimed");
    await database.update(interviewQuestions).set({ status: "awaiting_answer", closedAt: null })
      .where(eq(interviewQuestions.id, opening.question.id));
    await assert.rejects(submitInterviewAnswer({
      userId,
      interviewId: created.interviewId,
      idempotencyKey: "answer-while-running",
      request: { ...request, content: "running conflict" },
    }, { database }), /already evaluating/);
    await database.update(interviewQuestions).set({ status: "answered", closedAt: new Date() })
      .where(eq(interviewQuestions.id, opening.question.id));
    await assert.rejects(commitInterviewAgentAction({
      userId,
      sessionId: firstTurn.session.id,
      agentRunId: firstTurn.agentRun.id,
      interviewId: firstTurn.interview.id,
      interviewRunId: firstTurn.logicalRun.id,
      attemptGeneration: firstTurn.logicalRun.attemptGeneration,
      action: {
        answerAnalysis: null,
        action: {
          type: "ask_question",
          kind: "main",
          question: "缺少分析的问题",
          topic: "新主题",
          resumeEvidenceIds: [],
        },
      },
    }, { database }), /must include answer analysis/);
    const analysis = {
      completeness: "high",
      specificity: "medium",
      evidenceStrength: "medium",
      reflectionDepth: "low",
      followUpNeeded: true,
      missingPoints: ["失败恢复"],
      extractedEvidence: ["事件日志与事务提交"],
    } as const;
    const followUp = await commitInterviewAgentAction({
      userId,
      sessionId: firstTurn.session.id,
      agentRunId: firstTurn.agentRun.id,
      interviewId: firstTurn.interview.id,
      interviewRunId: firstTurn.logicalRun.id,
      attemptGeneration: firstTurn.logicalRun.attemptGeneration,
      action: {
        answerAnalysis: analysis,
        action: {
          type: "ask_question",
          kind: "follow_up",
          question: "当执行进程在事务提交后崩溃时，你如何恢复并避免重复问题？",
          topic: "系统设计",
          resumeEvidenceIds: [opening.evidenceId],
        },
      },
    }, { database });
    assert.equal("completed" in followUp, false);
    if ("completed" in followUp) throw new Error("Follow-up unexpectedly completed the interview");
    assert.equal(followUp.kind, "follow_up");
    const replayedFollowUp = await commitInterviewAgentAction({
      userId,
      sessionId: firstTurn.session.id,
      agentRunId: firstTurn.agentRun.id,
      interviewId: firstTurn.interview.id,
      interviewRunId: firstTurn.logicalRun.id,
      attemptGeneration: firstTurn.logicalRun.attemptGeneration,
      action: {
        answerAnalysis: analysis,
        action: {
          type: "ask_question",
          kind: "follow_up",
          question: "当执行进程在事务提交后崩溃时，你如何恢复并避免重复问题？",
          topic: "系统设计",
          resumeEvidenceIds: [opening.evidenceId],
        },
      },
    }, { database });
    assert.equal(replayedFollowUp.id, followUp.id);
    await assert.rejects(submitInterviewAnswer({
      userId,
      interviewId: created.interviewId,
      idempotencyKey: "answer-before-agent-handoff",
      request: { questionId: followUp.id, skipped: true },
    }, { database }), /still settling/);
    await database.update(agentRuns).set({ status: "completed", completedAt: new Date() })
      .where(eq(agentRuns.id, firstTurn.agentRun.id));
    await database.update(agentSessions).set({ status: "idle" })
      .where(eq(agentSessions.id, firstTurn.session.id));

    const skipped = await submitInterviewAnswer({
      userId,
      interviewId: created.interviewId,
      idempotencyKey: "answer-2-skip",
      request: { questionId: followUp.id, skipped: true },
    }, { database });
    const finalTurn = await claimInterviewTurnRun({
      database,
      userId,
      interviewRunId: skipped.run.id,
      buildModelMessage: () => ({ role: "user", content: "skip turn" }),
    });
    assert.equal(finalTurn.state, "claimed");
    if (finalTurn.state !== "claimed") throw new Error("Skip turn was not claimed");
    await assert.rejects(commitInterviewAgentAction({
      userId,
      sessionId: finalTurn.session.id,
      agentRunId: finalTurn.agentRun.id,
      interviewId: finalTurn.interview.id,
      interviewRunId: finalTurn.logicalRun.id,
      attemptGeneration: finalTurn.logicalRun.attemptGeneration,
      action: {
        answerAnalysis: null,
        action: {
          type: "ask_question",
          kind: "main",
          question: "达到轮数后不应再提问",
          topic: "其他",
          resumeEvidenceIds: [],
        },
      },
    }, { database }), /must complete/);
    await commitInterviewAgentAction({
      userId,
      sessionId: finalTurn.session.id,
      agentRunId: finalTurn.agentRun.id,
      interviewId: finalTurn.interview.id,
      interviewRunId: finalTurn.logicalRun.id,
      attemptGeneration: finalTurn.logicalRun.attemptGeneration,
      action: {
        answerAnalysis: null,
        action: { type: "complete_interview", closingMessage: "面试已完成。" },
      },
    }, { database });

    const [completedInterview] = await database.select().from(interviews)
      .where(eq(interviews.id, created.interviewId));
    const answers = await database.select().from(interviewAnswers)
      .where(eq(interviewAnswers.interviewId, created.interviewId));
    const completionEvents = await database.select().from(agentEvents).where(and(
      eq(agentEvents.sessionId, created.agentSessionId),
      eq(agentEvents.type, "interview/completion_requested"),
    ));
    assert.equal(completedInterview.status, "completing");
    assert.equal(completedInterview.answeredRoundCount, 2);
    assert.deepEqual(answers.find(({ id }) => id === submissions[0].answer.id)?.analysisJson, analysis);
    assert.equal(answers.find(({ id }) => id === skipped.answer.id)?.analysisJson, null);
    assert.equal(completionEvents.length, 1);

    const topicSwitch = await create("topic-switch", 3);
    const topicOpening = await open(topicSwitch, "请介绍 Straße API 的事件驱动架构设计。 ");
    const topicAnswer = await submitInterviewAnswer({
      userId,
      interviewId: topicSwitch.interviewId,
      idempotencyKey: "topic-answer-1",
      request: { questionId: topicOpening.question.id, content: "我用事件日志记录状态变化。", skipped: false },
    }, { database });
    const topicFirstTurn = await claimInterviewTurnRun({
      database,
      userId,
      interviewRunId: topicAnswer.run.id,
      buildModelMessage: () => ({ role: "user", content: "topic turn one" }),
    });
    assert.equal(topicFirstTurn.state, "claimed");
    if (topicFirstTurn.state !== "claimed") throw new Error("Topic turn was not claimed");
    const topicFollowUp = await commitInterviewAgentAction({
      userId,
      sessionId: topicFirstTurn.session.id,
      agentRunId: topicFirstTurn.agentRun.id,
      interviewId: topicFirstTurn.interview.id,
      interviewRunId: topicFirstTurn.logicalRun.id,
      attemptGeneration: topicFirstTurn.logicalRun.attemptGeneration,
      action: {
        answerAnalysis: analysis,
        action: {
          type: "ask_question",
          kind: "follow_up",
          question: "事件重放时如何处理重复消费？",
          topic: "系统设计",
          resumeEvidenceIds: [topicOpening.evidenceId],
        },
      },
    }, { database });
    if ("completed" in topicFollowUp) throw new Error("Topic follow-up unexpectedly completed");
    await database.update(agentRuns).set({ status: "completed", completedAt: new Date() })
      .where(eq(agentRuns.id, topicFirstTurn.agentRun.id));
    await database.update(agentSessions).set({ status: "idle" })
      .where(eq(agentSessions.id, topicFirstTurn.session.id));

    const topicFollowUpAnswer = await submitInterviewAnswer({
      userId,
      interviewId: topicSwitch.interviewId,
      idempotencyKey: "topic-answer-2",
      request: { questionId: topicFollowUp.id, content: "使用幂等消费键和去重表。", skipped: false },
    }, { database });
    const topicSecondTurn = await claimInterviewTurnRun({
      database,
      userId,
      interviewRunId: topicFollowUpAnswer.run.id,
      buildModelMessage: () => ({ role: "user", content: "topic turn two" }),
    });
    assert.equal(topicSecondTurn.state, "claimed");
    if (topicSecondTurn.state !== "claimed") throw new Error("Second topic turn was not claimed");
    const mainAnalysis = { ...analysis, followUpNeeded: false };
    await assert.rejects(commitInterviewAgentAction({
      userId,
      sessionId: topicSecondTurn.session.id,
      agentRunId: topicSecondTurn.agentRun.id,
      interviewId: topicSecondTurn.interview.id,
      interviewRunId: topicSecondTurn.logicalRun.id,
      attemptGeneration: topicSecondTurn.logicalRun.attemptGeneration,
      action: {
        answerAnalysis: mainAnalysis,
        action: {
          type: "ask_question",
          kind: "main",
          question: "换一种措辞继续讨论事件系统。",
          topic: "系统设计",
          resumeEvidenceIds: [],
        },
      },
    }, { database }), /different topic/);
    await assert.rejects(commitInterviewAgentAction({
      userId,
      sessionId: topicSecondTurn.session.id,
      agentRunId: topicSecondTurn.agentRun.id,
      interviewId: topicSecondTurn.interview.id,
      interviewRunId: topicSecondTurn.logicalRun.id,
      attemptGeneration: topicSecondTurn.logicalRun.attemptGeneration,
      action: {
        answerAnalysis: mainAnalysis,
        action: {
          type: "ask_question",
          kind: "main",
          question: "请介绍 STRASSE API 的事件驱动架构设计！",
          topic: "团队协作",
          resumeEvidenceIds: [],
        },
      },
    }, { database }), /duplicates a previous question/);
    const switchedQuestion = await commitInterviewAgentAction({
      userId,
      sessionId: topicSecondTurn.session.id,
      agentRunId: topicSecondTurn.agentRun.id,
      interviewId: topicSecondTurn.interview.id,
      interviewRunId: topicSecondTurn.logicalRun.id,
      attemptGeneration: topicSecondTurn.logicalRun.attemptGeneration,
      action: {
        answerAnalysis: mainAnalysis,
        action: {
          type: "ask_question",
          kind: "main",
          question: "你如何推动跨团队技术决策？",
          topic: "团队协作",
          resumeEvidenceIds: [],
        },
      },
    }, { database });
    if ("completed" in switchedQuestion) throw new Error("Topic switch unexpectedly completed");
    assert.equal(switchedQuestion.topic, "团队协作");

    const ownership = await create("session-ownership", 2);
    const ownershipOpening = await open(ownership, "请介绍一个关键项目。 ");
    const [foreignSession] = await database.insert(agentSessions).values({
      userId: foreignUserId,
      title: "Foreign interview session",
      model: "test/model",
      capability: "interview",
      promptVersion: "interview-agent-v2",
      systemPrompt: "test",
      workspaceRoot: null,
    }).returning();
    const [workspaceSession] = await database.insert(agentSessions).values({
      userId,
      title: "Wrong capability session",
      model: "test/model",
      capability: "workspace",
      promptVersion: "workspace-agent-v1",
      systemPrompt: "test",
      workspaceRoot: "/tmp/seconda-test-workspace",
    }).returning();
    const ownershipRequest = {
      questionId: ownershipOpening.question.id,
      content: "关键项目回答",
      skipped: false,
    };
    for (const invalidSessionId of [foreignSession.id, workspaceSession.id]) {
      await database.update(interviews).set({ agentSessionId: invalidSessionId })
        .where(eq(interviews.id, ownership.interviewId));
      await assert.rejects(submitInterviewAnswer({
        userId,
        interviewId: ownership.interviewId,
        idempotencyKey: `invalid-session-answer-${invalidSessionId}`,
        request: ownershipRequest,
      }, { database }), /Interview not found/);
      await assert.rejects(requestInterviewCompletion({
        userId,
        interviewId: ownership.interviewId,
      }, { database }), /Interview not found/);
    }
    await database.update(interviews).set({ agentSessionId: ownership.agentSessionId })
      .where(eq(interviews.id, ownership.interviewId));
    const ownershipAnswers = await database.select().from(interviewAnswers)
      .where(eq(interviewAnswers.interviewId, ownership.interviewId));
    assert.equal(ownershipAnswers.length, 0);

    const early = await create("early-completion", 3);
    const earlyOpening = await open(early, "请介绍一个最有挑战的项目。");
    const firstEnd = await requestInterviewCompletion({ userId, interviewId: early.interviewId }, { database });
    const replayedEnd = await requestInterviewCompletion({ userId, interviewId: early.interviewId }, { database });
    assert.equal(firstEnd.replayed, false);
    assert.equal(replayedEnd.replayed, true);
    const [abandoned] = await database.select().from(interviewQuestions)
      .where(eq(interviewQuestions.id, earlyOpening.question.id));
    const [endedInterview] = await database.select().from(interviews)
      .where(eq(interviews.id, early.interviewId));
    assert.equal(abandoned.status, "abandoned");
    assert.equal(endedInterview.status, "completing");
    assert.equal(endedInterview.answeredRoundCount, 0);
  } finally {
    await database.delete(interviews).where(eq(interviews.userId, userId));
    await database.delete(users).where(inArray(users.id, [userId, foreignUserId]));
    await client.end();
    const { closeAgentRepositoryConnection } = await import("@/lib/agent/repository");
    await closeAgentRepositoryConnection();
  }
});
