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

  for (const source of [resume, interview]) {
    assert.doesNotMatch(source, /chatLanguageModel|@ai-sdk\/openai|generateText\s*\(/);
  }
});
