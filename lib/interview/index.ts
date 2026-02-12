import { generateObject } from "ai";
import { chatLanguageModel } from "@/lib/ai/chat-provider";
import {
  generatedQuestionsSchema,
  scoreResultSchema,
  interviewReportSchema,
  followUpRoundSchema,
  coachStartSchema,
  coachEvaluateSchema,
  type GeneratedQuestion,
  type ScoreResult,
  type InterviewReport,
  type FollowUpRound,
  type CoachStart,
  type CoachEvaluate,
} from "./schemas";

export async function generateInterviewQuestions(params: {
  resumeData: unknown;
  resumeText: string;
  level: string;
  type: string;
  language: string;
  persona: string;
  count: number;
  history?: { question: string; answer: string }[];
}): Promise<GeneratedQuestion[]> {
  const truncatedText = params.resumeText.slice(0, 8000);
  const resumeDataStr = JSON.stringify(params.resumeData).slice(0, 8000);

  let prompt = `候选人简历（结构化数据）：
${resumeDataStr}

候选人简历（原文）：
${truncatedText}

面试配置：
- 难度级别：${params.level}
- 面试类型：${params.type}
- 面试官角色：${params.persona}
- 语言：${params.language}
- 生成数量：${params.count}`;

  if (params.history && params.history.length > 0) {
    prompt += `\n\n已有问答记录：\n${params.history.map((h, i) => `Q${i + 1}: ${h.question}\nA${i + 1}: ${h.answer}`).join("\n\n")}`;
  }

  if (params.language !== "zh") {
    prompt += `\n\n请用${params.language}语言生成面试问题。`;
  }

  const { object } = await generateObject({
    model: chatLanguageModel,
    schema: generatedQuestionsSchema,
    system: "你是专业的AI面试官。根据候选人的简历背景生成面试问题。问题必须与简历中的经验和技能相关。根据面试类型（行为/技术/混合）和难度级别生成合适的问题。每个问题需附带一条实用的回答建议。不得虚构简历中不存在的信息。",
    prompt,
  });

  return object.questions;
}

export async function scoreInterviewAnswer(params: {
  question: string;
  answer: string;
  questionType: string;
  level: string;
  persona: string;
  language: string;
  resumeContext: string;
}): Promise<ScoreResult> {
  const prompt = `面试问题：${params.question}
候选人回答：${params.answer}

问题类型：${params.questionType}
难度级别：${params.level}
面试官角色：${params.persona}
语言：${params.language}
简历摘要：${params.resumeContext}`;

  const { object } = await generateObject({
    model: chatLanguageModel,
    schema: scoreResultSchema,
    system: "你是专业的面试评估专家。请根据以下六个维度对候选人的回答进行评分（0-10分）：理解力(Understanding)、表达力(Expression)、逻辑性(Logic)、深度(Depth)、真实性(Authenticity)、反思力(Reflection)。同时提供优点、改进建议和深度分析。评分必须客观公正，基于回答内容本身。",
    prompt,
  });

  return object;
}

export async function generateInterviewReport(params: {
  questions: {
    question: string;
    answer: string;
    scores: {
      understanding: number;
      expression: number;
      logic: number;
      depth: number;
      authenticity: number;
      reflection: number;
      overall: number;
    };
  }[];
  level: string;
  type: string;
  language: string;
  resumeSummary: string;
}): Promise<InterviewReport> {
  const questionsDetail = params.questions
    .map(
      (q, i) =>
        `第${i + 1}题：
问题：${q.question}
回答：${q.answer}
评分：理解力=${q.scores.understanding}, 表达力=${q.scores.expression}, 逻辑性=${q.scores.logic}, 深度=${q.scores.depth}, 真实性=${q.scores.authenticity}, 反思力=${q.scores.reflection}, 综合=${q.scores.overall}`
    )
    .join("\n\n");

  const prompt = `面试记录：
${questionsDetail}

面试配置：
- 难度级别：${params.level}
- 面试类型：${params.type}
- 语言：${params.language}

候选人简历摘要：${params.resumeSummary}`;

  const { object } = await generateObject({
    model: chatLanguageModel,
    schema: interviewReportSchema,
    system: "你是专业的面试教练。请基于候选人的所有面试回答和评分，生成一份全面的面试评估报告。报告应包含总分（0-100）、六维能力平均分、核心优势、需要改进的关键领域、总结和下一步建议。",
    prompt,
  });

  return object;
}

export async function generateFollowUp(params: {
  question: string;
  originalAnswer: string;
  improvements: string[];
  history: { role: "assistant" | "user"; content: string }[];
  language: string;
}): Promise<FollowUpRound> {
  let prompt = `原始面试问题：${params.question}
候选人原始回答：${params.originalAnswer}

初始反馈中指出的不足：
${params.improvements.map((imp, i) => `${i + 1}. ${imp}`).join("\n")}`;

  if (params.history.length > 0) {
    prompt += `\n\n追问对话记录：\n${params.history.map((h) => `${h.role === "assistant" ? "面试官" : "候选人"}：${h.content}`).join("\n")}`;
  }

  prompt += `\n\n基于候选人回答中的不足，提出1个具体追问。不要一次问多个问题。给出简短点评（1-2句）。`;

  if (params.language !== "zh") {
    prompt += `\n\n请用${params.language}语言回复。`;
  }

  const { object } = await generateObject({
    model: chatLanguageModel,
    schema: followUpRoundSchema,
    system: "你正在通过追问验证候选人的真实理解深度。",
    prompt,
  });

  return object;
}

export async function generateCoachContent(params: {
  question: string;
  originalAnswer: string;
  feedback: { strengths: string[]; improvements: string[] };
  language: string;
}): Promise<CoachStart> {
  let prompt = `原始面试问题：${params.question}
候选人原始回答：${params.originalAnswer}

初始反馈：
- 优点：${params.feedback.strengths.join("；")}
- 改进建议：${params.feedback.improvements.join("；")}

输出顺序：1. 知识点讲解 2. 常见误区 3. 一个练习问题。等待用户回答后再评分。`;

  if (params.language !== "zh") {
    prompt += `\n\n请用${params.language}语言回复。`;
  }

  const { object } = await generateObject({
    model: chatLanguageModel,
    schema: coachStartSchema,
    system: "你是面试教练，而非面试官。",
    prompt,
  });

  return object;
}

export async function evaluateCoachAnswer(params: {
  originalQuestion: string;
  practiceQuestion: string;
  answer: string;
  language: string;
}): Promise<CoachEvaluate> {
  let prompt = `原始面试问题（提供上下文）：${params.originalQuestion}
练习问题：${params.practiceQuestion}
候选人回答：${params.answer}

请根据六个维度评分（0-10分），给出简短反馈和改进建议。`;

  if (params.language !== "zh") {
    prompt += `\n\n请用${params.language}语言回复。`;
  }

  const { object } = await generateObject({
    model: chatLanguageModel,
    schema: coachEvaluateSchema,
    system: "你是面试教练。请对候选人的练习回答进行评分和点评。",
    prompt,
  });

  return object;
}
