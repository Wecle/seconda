import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = process.cwd();

function exportedFunction(source: string, name: string) {
  const start = source.indexOf(`export async function ${name}`);
  assert.notEqual(start, -1, `${name} must be exported`);
  const next = source.indexOf("\nexport async function ", start + 1);
  return source.slice(start, next === -1 ? undefined : next);
}

test("routes every non-streaming business task through the shared generator", async () => {
  const [resume, interview] = await Promise.all([
    readFile(`${root}/lib/resume/parse-resume.ts`, "utf8"),
    readFile(`${root}/lib/interview/index.ts`, "utf8"),
  ]);
  const expected = [
    [resume, "parseResumeWithAI", "resume.parse", "parsedResumeSchema"],
    [interview, "generateInterviewQuestions", "question.generate", "generatedQuestionsSchema"],
    [interview, "scoreInterviewAnswer", "answer.score", "scoreResultSchema"],
    [interview, "generateInterviewReport", "report.generate", "interviewReportSchema"],
    [interview, "generateFollowUp", "question.follow-up", "followUpRoundSchema"],
    [interview, "generateCoachContent", "coach.generate", "coachStartSchema"],
    [interview, "evaluateCoachAnswer", "coach.evaluate", "coachEvaluateSchema"],
  ] as const;

  for (const [source, functionName, task, schema] of expected) {
    const body = exportedFunction(source, functionName);
    assert.match(body, /generateStructured/);
    assert.match(body, new RegExp(`task:\\s*["']${task}["']`));
    assert.match(body, new RegExp(`schema:\\s*${schema}`));
  }

  const forbiddenDirectCalls = new RegExp(
    ["chat" + "LanguageModel", "@ai-sdk/" + "openai", "generate" + "Text\\s*\\("].join("|"),
  );
  for (const source of [resume, interview]) {
    assert.doesNotMatch(source, forbiddenDirectCalls);
  }
});

test("does not retain streamed legacy next-question generation", async () => {
  const route = await readFile(
    `${root}/app/api/interviews/[id]/next-question/route.ts`,
    "utf8",
  );
  const body = exportedFunction(route, "POST");

  assert.match(body, /legacyInterviewReadOnlyResponse/);
  assert.doesNotMatch(body, /streamStructured|question\.generate|generatedQuestionSchema/);
});

test("composed structured tasks use deterministic business correlation keys", async () => {
  const [upload, reparse, generate, followup, coach, compaction] = await Promise.all([
    readFile(`${root}/app/api/resumes/upload/route.ts`, "utf8"),
    readFile(`${root}/app/api/resumes/[id]/versions/[versionId]/reparse/route.ts`, "utf8"),
    readFile(`${root}/app/api/resumes/generate/route.ts`, "utf8"),
    readFile(`${root}/app/api/interviews/[id]/questions/[questionId]/deep-dive/followup/route.ts`, "utf8"),
    readFile(`${root}/app/api/interviews/[id]/questions/[questionId]/deep-dive/coach/route.ts`, "utf8"),
    readFile(`${root}/lib/interview/agent/context/persisted-compaction.ts`, "utf8"),
  ]);
  assert.match(upload, /operationKey: `resume\.parse:\$\{versionId\}`/);
  assert.match(reparse, /operationKey: `resume\.parse:\$\{versionId\}`/);
  assert.match(generate, /operationKey: `resume\.generate:\$\{parsed\.data\.idempotencyKey\}`/);
  assert.match(followup, /operationKey: `question\.follow-up:\$\{session\.id\}:start`/);
  assert.match(followup, /operationKey: `question\.follow-up:\$\{session\.id\}:\$\{userMsg\.id\}`/);
  assert.match(coach, /operationKey: `coach\.generate:\$\{session\.id\}:start`/);
  assert.match(coach, /operationKey: `coach\.evaluate:\$\{session\.id\}:\$\{userMsg\.id\}`/);
  const sessionId = "session-id";
  const firstUserMessageId = "message-id-1";
  const secondUserMessageId = "message-id-2";
  assert.notEqual(
    `question.follow-up:${sessionId}:${firstUserMessageId}`,
    `question.follow-up:${sessionId}:${secondUserMessageId}`,
  );
  assert.notEqual(
    `coach.evaluate:${sessionId}:${firstUserMessageId}`,
    `coach.evaluate:${sessionId}:${secondUserMessageId}`,
  );
  assert.match(compaction, /operationKey: `context\.compact:\$\{input\.runId\}:\$\{/);
});
