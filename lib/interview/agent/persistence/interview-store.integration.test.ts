import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";

import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "@/lib/db/schema";
import {
  interviewAgentRuns,
  interviewMessages,
  interviewQuestions,
  interviews,
  resumes,
  resumeVersions,
  users,
} from "@/lib/db/schema";
import { createDrizzleAgentInterviewStore } from "@/lib/interview/agent/persistence/interview-store";
import { AgentRequestConflictError } from "@/lib/interview/agent/protocols/errors";
import {
  ANSWER_RUN_INSTRUCTION,
  OPENING_CLARIFICATION_RUN_INSTRUCTION,
} from "@/lib/interview/agent/prompts/turn-instructions";

test("conflicting answer replay leaves the accepted transaction unchanged", {
  skip: process.env.DATABASE_URL ? false : "DATABASE_URL is not configured",
}, async () => {
  const client = postgres(process.env.DATABASE_URL!, { prepare: false });
  const db = drizzle(client, { schema });
  const userId = randomUUID();
  const resumeId = randomUUID();
  const versionId = randomUUID();
  let interviewId: string | null = null;
  const additionalInterviewIds: string[] = [];

  try {
    await db.insert(users).values({
      id: userId,
      email: `${userId}@example.test`,
    });
    await db.insert(resumes).values({
      id: resumeId,
      userId,
      title: "Idempotency conflict resume",
    });
    await db.insert(resumeVersions).values({
      id: versionId,
      resumeId,
      versionNumber: 1,
      originalFilename: "resume.pdf",
      storedPath: `https://blob.example/${versionId}.pdf`,
      extractedText: "Built reliable TypeScript services",
      parsedJson: {
        name: "Candidate",
        skills: ["TypeScript"],
        experience: [],
        education: [],
        projects: [],
        summary: "",
      },
      parseStatus: "parsed",
    });

    const store = createDrizzleAgentInterviewStore(db);
    const created = await store.createInterview({
      ownerUserId: userId,
      idempotencyKey: randomUUID(),
      resumeVersionId: versionId,
      config: {
        configVersion: 2,
        language: "zh",
        persona: "standard",
        preference: "",
        preferenceTags: [],
      },
    });
    interviewId = created.interviewId;
    const [opening] = await db.select({
      openingStage: interviews.openingStage,
      targetRoleConfirmationMessageId:
        interviews.targetRoleConfirmationMessageId,
    }).from(interviews).where(eq(interviews.id, interviewId));
    assert.deepEqual(opening, {
      openingStage: "role_resolution",
      targetRoleConfirmationMessageId: null,
    });
    await db.insert(interviewQuestions).values({
      interviewId,
      questionIndex: 1,
      questionType: "technical_depth",
      topic: "reliability",
      question: "你如何保证服务可靠性？",
    });
    const [insertedQuestion] = await db.select({
      purpose: interviewQuestions.purpose,
    }).from(interviewQuestions).where(eq(
      interviewQuestions.interviewId,
      interviewId,
    ));
    assert.equal(insertedQuestion?.purpose, "formal");
    await db.update(interviews).set({
      openingStage: "formal_interview",
    }).where(eq(interviews.id, interviewId));

    const answerKey = randomUUID();
    await store.acceptCandidateMessage({
      interviewId,
      content: "旧回答",
      idempotencyKey: answerKey,
      runIdempotencyKey: `message:${answerKey}`,
      instructions: {
        answer: "Assess the accepted answer",
        openingClarification: "Confirm the role",
      },
    });

    const snapshot = await loadAcceptedAnswerState(db, interviewId);
    await assert.rejects(
      store.acceptCandidateMessage({
        interviewId,
        content: "新回答",
        idempotencyKey: answerKey,
        runIdempotencyKey: `message:${randomUUID()}`,
        instructions: {
          answer: "Assess the conflicting answer",
          openingClarification: "Confirm the role",
        },
      }),
      AgentRequestConflictError,
    );
    assert.deepEqual(
      await loadAcceptedAnswerState(db, interviewId),
      snapshot,
    );

    const clarificationInterview = await store.createInterview({
      ownerUserId: userId,
      idempotencyKey: randomUUID(),
      resumeVersionId: versionId,
      config: {
        configVersion: 2,
        language: "zh",
        persona: "standard",
        preference: "",
        preferenceTags: [],
      },
    });
    additionalInterviewIds.push(clarificationInterview.interviewId);
    await db.update(interviews).set({
      openingStage: "awaiting_role_clarification",
    }).where(eq(interviews.id, clarificationInterview.interviewId));
    const [clarificationQuestion] = await db.insert(interviewQuestions).values({
      interviewId: clarificationInterview.interviewId,
      questionIndex: 1,
      purpose: "opening_clarification",
      questionType: null,
      topic: "target_role",
      question: "你希望面试什么岗位？",
    }).returning({ id: interviewQuestions.id });
    const clarificationKey = randomUUID();
    const clarificationInput = {
      interviewId: clarificationInterview.interviewId,
      content: "前端工程师",
      idempotencyKey: clarificationKey,
      runIdempotencyKey: `message:${clarificationKey}`,
      instructions: {
        answer: ANSWER_RUN_INSTRUCTION,
        openingClarification: OPENING_CLARIFICATION_RUN_INSTRUCTION,
      },
    };
    const acceptedClarification = await store.acceptCandidateMessage(clarificationInput);
    const replayedClarification = await store.acceptCandidateMessage(clarificationInput);
    assert.equal(acceptedClarification.created, true);
    assert.equal(replayedClarification.created, false);
    const [clarificationState, clarificationMessage, clarificationRun] = await Promise.all([
      db.select({ candidateRoundCount: interviews.candidateRoundCount })
        .from(interviews)
        .where(eq(interviews.id, clarificationInterview.interviewId)),
      db.select({
        kind: interviewMessages.kind,
        questionId: interviewMessages.questionId,
      }).from(interviewMessages)
        .where(eq(interviewMessages.id, acceptedClarification.id)),
      db.select({ trigger: interviewAgentRuns.triggerJson })
        .from(interviewAgentRuns)
        .where(eq(interviewAgentRuns.id, acceptedClarification.runId)),
    ]);
    assert.equal(clarificationState[0]?.candidateRoundCount, 0);
    assert.deepEqual(clarificationMessage[0], {
      kind: "clarification_answer",
      questionId: clarificationQuestion.id,
    });
    assert.deepEqual(clarificationRun[0]?.trigger, {
      mode: "opening_clarification",
      instruction: OPENING_CLARIFICATION_RUN_INSTRUCTION,
      answerMessageId: acceptedClarification.id,
    });

    const mismatchInterview = await store.createInterview({
      ownerUserId: userId,
      idempotencyKey: randomUUID(),
      resumeVersionId: versionId,
      config: {
        configVersion: 2,
        language: "zh",
        persona: "standard",
        preference: "",
        preferenceTags: [],
      },
    });
    additionalInterviewIds.push(mismatchInterview.interviewId);
    const [mismatchQuestion] = await db.insert(interviewQuestions).values({
      interviewId: mismatchInterview.interviewId,
      questionIndex: 1,
      purpose: "opening_clarification",
      questionType: null,
      topic: "target_role",
      question: "你希望面试什么岗位？",
    }).returning({ id: interviewQuestions.id });
    await assert.rejects(store.acceptCandidateMessage({
      ...clarificationInput,
      interviewId: mismatchInterview.interviewId,
      idempotencyKey: randomUUID(),
      runIdempotencyKey: randomUUID(),
    }), /OPENING_STAGE_MISMATCH/);
    const mismatchState = await loadAcceptedAnswerState(db, mismatchInterview.interviewId);
    assert.equal(mismatchState.candidateRoundCount, 0);
    assert.equal(mismatchState.messages.length, 0);
    assert.equal(mismatchState.runs.length, 0);
    assert.equal(mismatchState.questions[0]?.id, mismatchQuestion.id);
    assert.equal(mismatchState.questions[0]?.answeredAt, null);
  } finally {
    try {
      if (interviewId) {
        await db.delete(interviews).where(eq(interviews.id, interviewId));
      }
      for (const id of additionalInterviewIds) {
        await db.delete(interviews).where(eq(interviews.id, id));
      }
      await db.delete(resumes).where(eq(resumes.id, resumeId));
      await db.delete(users).where(eq(users.id, userId));
    } finally {
      await client.end();
    }
  }
});

async function loadAcceptedAnswerState(
  db: ReturnType<typeof drizzle<typeof schema>>,
  interviewId: string,
) {
  const [interview, questions, messages, runs] = await Promise.all([
    db.select({
      candidateRoundCount: interviews.candidateRoundCount,
    }).from(interviews).where(eq(interviews.id, interviewId)),
    db.select({
      id: interviewQuestions.id,
      answerText: interviewQuestions.answerText,
      answeredAt: interviewQuestions.answeredAt,
    }).from(interviewQuestions)
      .where(eq(interviewQuestions.interviewId, interviewId))
      .orderBy(asc(interviewQuestions.questionIndex)),
    db.select({
      id: interviewMessages.id,
      runId: interviewMessages.runId,
      sequence: interviewMessages.sequence,
      idempotencyKey: interviewMessages.idempotencyKey,
      content: interviewMessages.content,
      questionId: interviewMessages.questionId,
    }).from(interviewMessages)
      .where(eq(interviewMessages.interviewId, interviewId))
      .orderBy(asc(interviewMessages.sequence)),
    db.select({
      id: interviewAgentRuns.id,
      idempotencyKey: interviewAgentRuns.idempotencyKey,
      status: interviewAgentRuns.status,
      triggerJson: interviewAgentRuns.triggerJson,
    }).from(interviewAgentRuns)
      .where(eq(interviewAgentRuns.interviewId, interviewId))
      .orderBy(asc(interviewAgentRuns.createdAt)),
  ]);

  return {
    candidateRoundCount: interview[0]?.candidateRoundCount,
    questions,
    messages,
    runs,
  };
}
