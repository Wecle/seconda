import assert from "node:assert/strict";
import test from "node:test";
import {
  computeInterviewAggregates,
  computeQuestionOverall,
  questionEvaluationSchema,
  questionScoresSchema,
  roundHalfUp,
  type QuestionScores,
  type ScoredQuestionInput,
} from "./domain/scoring";

test("questionScoresSchema validates 0-10 integers only", () => {
  const valid: QuestionScores = {
    understanding: 8,
    expression: 7,
    logic: 9,
    depth: 6,
    authenticity: 10,
    reflection: 0,
  };
  assert.deepEqual(questionScoresSchema.parse(valid), valid);

  // Reject float
  assert.throws(() => questionScoresSchema.parse({ ...valid, understanding: 7.5 }));

  // Reject negative
  assert.throws(() => questionScoresSchema.parse({ ...valid, expression: -1 }));

  // Reject > 10
  assert.throws(() => questionScoresSchema.parse({ ...valid, logic: 11 }));

  // Reject non-number
  assert.throws(() => questionScoresSchema.parse({ ...valid, depth: "8" }));
});

test("questionEvaluationSchema validates scores and textual feedback", () => {
  const valid = {
    scores: {
      understanding: 9,
      expression: 8,
      logic: 8,
      depth: 7,
      authenticity: 9,
      reflection: 8,
    },
    strengths: ["Clear structure", "Specific project examples"],
    improvements: ["Could provide deeper architectural trade-offs"],
    advice: "Focus on comparing alternative technologies next time.",
  };
  assert.deepEqual(questionEvaluationSchema.parse(valid), valid);

  // Rejects empty strengths
  assert.throws(() => questionEvaluationSchema.parse({ ...valid, strengths: [] }));

  // Rejects empty advice
  assert.throws(() => questionEvaluationSchema.parse({ ...valid, advice: "" }));
});

test("roundHalfUp handles exact positive half-up boundaries", () => {
  // 5 / 2 = 2.5 -> 3
  assert.equal(roundHalfUp(5, 2), 3);
  // 4 / 2 = 2.0 -> 2
  assert.equal(roundHalfUp(4, 2), 2);
  // 3 / 2 = 1.5 -> 2
  assert.equal(roundHalfUp(3, 2), 2);
  // 1 / 2 = 0.5 -> 1
  assert.equal(roundHalfUp(1, 2), 1);
  // 0 / 2 = 0 -> 0
  assert.equal(roundHalfUp(0, 2), 0);
  // 7 / 4 = 1.75 -> 2
  assert.equal(roundHalfUp(7, 4), 2);
  // 5 / 4 = 1.25 -> 1
  assert.equal(roundHalfUp(5, 4), 1);
  // 6 / 4 = 1.5 -> 2
  assert.equal(roundHalfUp(6, 4), 2);
  // 350 / 6 = 58.3333 -> 58
  assert.equal(roundHalfUp(350, 6), 58);
  // 351 / 6 = 58.5 -> 59
  assert.equal(roundHalfUp(351, 6), 59);

  // Errors on zero or negative
  assert.throws(() => roundHalfUp(5, 0));
  assert.throws(() => roundHalfUp(-5, 2));
  assert.throws(() => roundHalfUp(5, -2));
});

test("computeQuestionOverall computes sum, tenths, and rounded overall", () => {
  // All 0s -> 0.0
  const zero = computeQuestionOverall({
    understanding: 0,
    expression: 0,
    logic: 0,
    depth: 0,
    authenticity: 0,
    reflection: 0,
  });
  assert.equal(zero.questionScoreSum, 0);
  assert.equal(zero.questionOverallTenths, 0);
  assert.equal(zero.questionOverall, 0);

  // All 10s -> 10.0
  const max = computeQuestionOverall({
    understanding: 10,
    expression: 10,
    logic: 10,
    depth: 10,
    authenticity: 10,
    reflection: 10,
  });
  assert.equal(max.questionScoreSum, 60);
  assert.equal(max.questionOverallTenths, 100);
  assert.equal(max.questionOverall, 10.0);

  // Sum = 51 -> 51 * 10 / 6 = 510 / 6 = 85 -> 8.5
  const s51 = computeQuestionOverall({
    understanding: 9,
    expression: 9,
    logic: 8,
    depth: 8,
    authenticity: 9,
    reflection: 8,
  });
  assert.equal(s51.questionScoreSum, 51);
  assert.equal(s51.questionOverallTenths, 85);
  assert.equal(s51.questionOverall, 8.5);

  // Sum = 35 -> 35 * 10 / 6 = 350 / 6 = 58.333 -> 58 -> 5.8
  const s35 = computeQuestionOverall({
    understanding: 6,
    expression: 6,
    logic: 6,
    depth: 6,
    authenticity: 6,
    reflection: 5,
  });
  assert.equal(s35.questionScoreSum, 35);
  assert.equal(s35.questionOverallTenths, 58);
  assert.equal(s35.questionOverall, 5.8);

  // Sum = 37 -> 37 * 10 / 6 = 370 / 6 = 61.666 -> 62 -> 6.2
  const s37 = computeQuestionOverall({
    understanding: 7,
    expression: 6,
    logic: 6,
    depth: 6,
    authenticity: 6,
    reflection: 6,
  });
  assert.equal(s37.questionScoreSum, 37);
  assert.equal(s37.questionOverallTenths, 62);
  assert.equal(s37.questionOverall, 6.2);
});

test("computeInterviewAggregates handles 0 scorable answers", () => {
  const result = computeInterviewAggregates([]);
  assert.deepEqual(result, {
    scoreStatus: "no_scorable_answers",
    scoredQuestionCount: 0,
    overallScore: null,
    dimensionAverages: null,
  });
});

test("computeInterviewAggregates computes dimension averages and interview overall deterministically", () => {
  const q1: ScoredQuestionInput = {
    questionId: "q1",
    scores: {
      understanding: 9, // sum = 51 -> 8.5 (85 tenths)
      expression: 9,
      logic: 8,
      depth: 8,
      authenticity: 9,
      reflection: 8,
    },
  };
  const q2: ScoredQuestionInput = {
    questionId: "q2",
    scores: {
      understanding: 7, // sum = 42 -> 7.0 (70 tenths)
      expression: 7,
      logic: 7,
      depth: 7,
      authenticity: 7,
      reflection: 7,
    },
  };

  const result = computeInterviewAggregates([q1, q2]);
  assert.equal(result.scoreStatus, "scored");
  if (result.scoreStatus === "scored") {
    assert.equal(result.scoredQuestionCount, 2);
    // Dimension averages:
    // understanding: (9 + 7) / 2 = 16 / 2 = 8.0
    // expression: (9 + 7) / 2 = 8.0
    // logic: (8 + 7) / 2 = 15 / 2 = 7.5
    // depth: (8 + 7) / 2 = 7.5
    // authenticity: (9 + 7) / 2 = 8.0
    // reflection: (8 + 7) / 2 = 7.5
    assert.deepEqual(result.dimensionAverages, {
      understanding: 8.0,
      expression: 8.0,
      logic: 7.5,
      depth: 7.5,
      authenticity: 8.0,
      reflection: 7.5,
    });
    // Interview overall:
    // Q1 overall tenths: 85
    // Q2 overall tenths: 70
    // Sum = 155 tenths.
    // 155 / 2 = 77.5 -> roundHalfUp(155, 2) = 78
    assert.equal(result.overallScore, 78);
  }
});

test("computeInterviewAggregates interview overall matches average(per-question overall) * 10", () => {
  // 3 questions:
  // Q1: sum = 50 -> 500/6 = 83.333 -> 83 tenths (8.3)
  // Q2: sum = 50 -> 83 tenths (8.3)
  // Q3: sum = 51 -> 510/6 = 85 tenths (8.5)
  // Sum of tenths = 83 + 83 + 85 = 251 tenths.
  // 251 / 3 = 83.666 -> 84
  const q1: ScoredQuestionInput = {
    questionId: "q1",
    scores: {
      understanding: 9,
      expression: 8,
      logic: 9,
      depth: 8,
      authenticity: 8,
      reflection: 8,
    },
  };
  const q2: ScoredQuestionInput = {
    questionId: "q2",
    scores: {
      understanding: 9,
      expression: 8,
      logic: 9,
      depth: 8,
      authenticity: 8,
      reflection: 8,
    },
  };
  const q3: ScoredQuestionInput = {
    questionId: "q3",
    scores: {
      understanding: 9,
      expression: 9,
      logic: 8,
      depth: 8,
      authenticity: 9,
      reflection: 8,
    },
  };

  const result = computeInterviewAggregates([q1, q2, q3]);
  assert.equal(result.scoreStatus, "scored");
  if (result.scoreStatus === "scored") {
    assert.equal(result.overallScore, 84);
  }
});

test("all-zero scores produce scored status, overallScore 0, and correct prompt format", async () => {
  const { buildReportGenerationPrompt } = await import("./completion/prompt");
  const q1: ScoredQuestionInput = {
    questionId: "q1",
    scores: {
      understanding: 0,
      expression: 0,
      logic: 0,
      depth: 0,
      authenticity: 0,
      reflection: 0,
    },
  };
  const result = computeInterviewAggregates([q1]);
  assert.equal(result.scoreStatus, "scored");
  assert.equal(result.overallScore, 0);
  assert.deepEqual(result.dimensionAverages, {
    understanding: 0,
    expression: 0,
    logic: 0,
    depth: 0,
    authenticity: 0,
    reflection: 0,
  });

  const prompt = buildReportGenerationPrompt({
    targetRole: "Frontend Engineer",
    targetLevel: "Senior",
    interviewType: "technical",
    overallScore: result.overallScore,
    scoreStatus: result.scoreStatus,
    dimensionAverages: result.dimensionAverages,
    questions: [
      {
        sequence: 1,
        topic: "React",
        question: "Explain state.",
        answer: "I don't know.",
        skipped: false,
        scores: q1.scores,
      },
    ],
    resumeCanonicalText: "Resume text",
  });

  assert.ok(prompt.includes("面试综合总分：0 / 100"));
  assert.ok(!prompt.includes("未提供足够的可评分有效回答"));
});
