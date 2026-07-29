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

test("conflicting answer replay leaves the accepted transaction unchanged", {
  skip: process.env.DATABASE_URL ? false : "DATABASE_URL is not configured",
}, async () => {
  const client = postgres(process.env.DATABASE_URL!, { prepare: false });
  const db = drizzle(client, { schema });
  const userId = randomUUID();
  const resumeId = randomUUID();
  const versionId = randomUUID();
  let interviewId: string | null = null;

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
    await db.insert(interviewQuestions).values({
      interviewId,
      questionIndex: 1,
      questionType: "technical_depth",
      topic: "reliability",
      question: "你如何保证服务可靠性？",
    });

    const answerKey = randomUUID();
    await store.acceptCandidateMessage({
      interviewId,
      content: "旧回答",
      idempotencyKey: answerKey,
      runIdempotencyKey: `message:${answerKey}`,
      trigger: {
        mode: "answer",
        instruction: "Assess the accepted answer",
      },
    });

    const snapshot = await loadAcceptedAnswerState(db, interviewId);
    await assert.rejects(
      store.acceptCandidateMessage({
        interviewId,
        content: "新回答",
        idempotencyKey: answerKey,
        runIdempotencyKey: `message:${randomUUID()}`,
        trigger: {
          mode: "answer",
          instruction: "Assess the conflicting answer",
        },
      }),
      AgentRequestConflictError,
    );
    assert.deepEqual(
      await loadAcceptedAnswerState(db, interviewId),
      snapshot,
    );
  } finally {
    try {
      if (interviewId) {
        await db.delete(interviews).where(eq(interviews.id, interviewId));
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
