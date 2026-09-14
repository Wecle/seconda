import assert from "node:assert/strict";
import test from "node:test";
import {
  jobFitAnalysisSchema,
  jobFitSkillAssessmentSchema,
  reportSummarySchema,
  type JobFitAnalysis,
} from "../domain/scoring";
import { buildReportGenerationPrompt } from "./prompt";

test("jobFitSkillAssessmentSchema validates valid skill assessment and rejects invalid enums", () => {
  const valid = {
    skillName: "React 19 & Next.js",
    category: "must_have" as const,
    evaluation: "exceeded" as const,
    evidence: "深入讲解了 Server Components 与 Client Components 的边界与性能优化方案",
  };
  assert.deepEqual(jobFitSkillAssessmentSchema.parse(valid), valid);

  // Invalid evaluation
  assert.throws(() =>
    jobFitSkillAssessmentSchema.parse({
      ...valid,
      evaluation: "exceptional",
    })
  );

  // Invalid category
  assert.throws(() =>
    jobFitSkillAssessmentSchema.parse({
      ...valid,
      category: "bonus",
    })
  );
});

test("jobFitAnalysisSchema validates overallFitRating and structure", () => {
  const valid: JobFitAnalysis = {
    overallFitRating: "strong_fit",
    fitSummary: "候选人在前端工程化与性能优化方面展现出与 JD 强契合的能力，但在部分全栈技术上有待考察。",
    skillsAssessment: [
      {
        skillName: "TypeScript",
        category: "must_have",
        evaluation: "satisfied",
        evidence: "熟练使用高级类型与类型推断。",
      },
      {
        skillName: "分布式缓存",
        category: "nice_to_have",
        evaluation: "untested",
        evidence: "本次面试未深入涉及缓存架构。",
      },
    ],
    criticalGaps: ["缺乏大规模微前端拆分实战经历"],
    recommendedReverseQuestions: ["团队目前在微前端和构建提速上面临的最大瓶颈是什么？"],
  };

  assert.deepEqual(jobFitAnalysisSchema.parse(valid), valid);

  // Invalid fit rating
  assert.throws(() =>
    jobFitAnalysisSchema.parse({
      ...valid,
      overallFitRating: "perfect",
    })
  );
});

test("reportSummarySchema parses summary with valid jobFitAnalysis", () => {
  const summaryWithJd = {
    overallSummary: "候选人表现优异，技术底座扎实。",
    keyStrengths: ["架构设计思维清晰", "STAR表达严密"],
    keyImprovements: ["需加深对冷门边界情况的思考"],
    recommendations: "建议补充大规模复杂业务场景的实战积累。",
    jobFitAnalysis: {
      overallFitRating: "strong_fit" as const,
      fitSummary: "整体能力高度符合该资深前端岗位诉求。",
      skillsAssessment: [
        {
          skillName: "React 19",
          category: "must_have" as const,
          evaluation: "satisfied" as const,
          evidence: "清晰阐述了新特性与使用考量。",
        },
      ],
      criticalGaps: ["微前端经验偏少"],
      recommendedReverseQuestions: ["当前核心系统架构演进的最大挑战是什么？"],
    },
  };

  const parsed = reportSummarySchema.parse(summaryWithJd);
  assert.ok(parsed.jobFitAnalysis);
  assert.equal(parsed.jobFitAnalysis?.overallFitRating, "strong_fit");
  assert.equal(parsed.jobFitAnalysis?.skillsAssessment[0].skillName, "React 19");
});

test("reportSummarySchema parses summary without jobFitAnalysis (backward compatibility)", () => {
  const legacySummary = {
    overallSummary: "候选人表现良好。",
    keyStrengths: ["代码结构清晰"],
    keyImprovements: ["缺少量化指标"],
    recommendations: "建议提升回答精炼度。",
  };

  const parsed = reportSummarySchema.parse(legacySummary);
  assert.equal(parsed.jobFitAnalysis, undefined);
  assert.deepEqual(parsed, legacySummary);
});

test("buildReportGenerationPrompt includes JD section when present and omits it when null", () => {
  const baseInput = {
    targetRole: "资深前端专家",
    targetLevel: "Senior",
    interviewType: "technical",
    overallScore: 85,
    scoreStatus: "scored" as const,
    dimensionAverages: {
      understanding: 8.5,
      expression: 8.0,
      logic: 9.0,
      depth: 8.5,
      authenticity: 8.5,
      reflection: 8.0,
    },
    questions: [
      {
        sequence: 1,
        topic: "React 架构",
        question: "请谈明你对 React 19 Action 的理解",
        answer: "我的回答...",
        skipped: false,
        scores: {
          understanding: 9,
          expression: 8,
          logic: 9,
          depth: 8,
          authenticity: 9,
          reflection: 8,
        },
      },
    ],
    resumeCanonicalText: "简历文本数据",
  };

  // 1. With JD (including company)
  const promptWithJdAndCompany = buildReportGenerationPrompt({
    ...baseInput,
    jobDescription: {
      title: "资深前端专家",
      company: "Seconda AI",
      canonicalText: "岗位要求：精通 React 19，精通 TypeScript，主导大型项目架构。",
    },
  });

  assert.match(promptWithJdAndCompany, /【目标岗位 JD（不可信参考数据）】/);
  assert.match(promptWithJdAndCompany, /- 岗位：资深前端专家 \| 公司：Seconda AI/);
  assert.match(promptWithJdAndCompany, /<<<JOB_DESCRIPTION_DATA/);
  assert.match(promptWithJdAndCompany, /精通 React 19/);
  assert.match(promptWithJdAndCompany, /JOB_DESCRIPTION_DATA>>>/);

  // 2. With JD (without company)
  const promptWithJdNoCompany = buildReportGenerationPrompt({
    ...baseInput,
    jobDescription: {
      title: "全栈工程师",
      company: null,
      canonicalText: "岗位要求：Node.js 与 React。",
    },
  });

  assert.match(promptWithJdNoCompany, /【目标岗位 JD（不可信参考数据）】/);
  assert.match(promptWithJdNoCompany, /- 岗位：全栈工程师\n/);
  assert.doesNotMatch(promptWithJdNoCompany, /公司：/);

  // 3. Without JD (null)
  const promptWithoutJd = buildReportGenerationPrompt({
    ...baseInput,
    jobDescription: null,
  });

  assert.doesNotMatch(promptWithoutJd, /【目标岗位 JD（不可信参考数据）】/);
  assert.doesNotMatch(promptWithoutJd, /JOB_DESCRIPTION_DATA/);

  // 4. Without JD (undefined)
  const promptUndefinedJd = buildReportGenerationPrompt({
    ...baseInput,
  });

  assert.doesNotMatch(promptUndefinedJd, /【目标岗位 JD（不可信参考数据）】/);
  assert.doesNotMatch(promptUndefinedJd, /JOB_DESCRIPTION_DATA/);
});

test("buildReportGenerationPrompt handles no_scorable_answers with JD", () => {
  const prompt = buildReportGenerationPrompt({
    targetRole: "资深前端专家",
    targetLevel: "Senior",
    interviewType: "technical",
    overallScore: null,
    scoreStatus: "no_scorable_answers",
    dimensionAverages: null,
    questions: [],
    resumeCanonicalText: "简历文本数据",
    jobDescription: {
      title: "资深前端专家",
      company: "Seconda",
      canonicalText: "岗位要求：精通 React 19。",
    },
  });

  assert.match(prompt, /本次面试中候选人未提供足够的可评分有效回答/);
  assert.match(prompt, /【目标岗位 JD（不可信参考数据）】/);
  assert.match(prompt, /资深前端专家 \| 公司：Seconda/);
  assert.match(prompt, /精通 React 19/);
});
