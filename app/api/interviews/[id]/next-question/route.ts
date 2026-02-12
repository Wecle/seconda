import { NextRequest, NextResponse } from "next/server";
import { generateObject } from "ai";
import { db } from "@/lib/db";
import {
  interviews,
  interviewQuestions,
  resumes,
  resumeVersions,
} from "@/lib/db/schema";
import { and, eq, asc, isNull, isNotNull } from "drizzle-orm";
import { getCurrentUserId } from "@/lib/auth/session";
import { chatLanguageModel } from "@/lib/ai/chat-provider";
import { generatedQuestionSchema } from "@/lib/interview/schemas";

export const maxDuration = 60;

function getNestedStatusCode(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;

  const maybeError = error as {
    statusCode?: unknown;
    lastError?: unknown;
    cause?: unknown;
  };

  if (typeof maybeError.statusCode === "number") {
    return maybeError.statusCode;
  }

  return (
    getNestedStatusCode(maybeError.lastError) ??
    getNestedStatusCode(maybeError.cause)
  );
}

function getNestedMessage(error: unknown): string {
  if (!error || typeof error !== "object") return "";

  const maybeError = error as {
    message?: unknown;
    responseBody?: unknown;
    lastError?: unknown;
    cause?: unknown;
  };

  if (typeof maybeError.responseBody === "string") {
    try {
      const parsed = JSON.parse(maybeError.responseBody) as {
        errors?: { message?: string };
      };
      if (typeof parsed.errors?.message === "string") {
        return parsed.errors.message;
      }
    } catch {}
  }

  if (typeof maybeError.message === "string") {
    return maybeError.message;
  }

  return (
    getNestedMessage(maybeError.lastError) ||
    getNestedMessage(maybeError.cause) ||
    ""
  );
}

function isRateLimitError(error: unknown): boolean {
  if (getNestedStatusCode(error) === 429) {
    return true;
  }

  const message = getNestedMessage(error).toLowerCase();
  return (
    message.includes("too many requests") ||
    message.includes("quota") ||
    message.includes("rate limit") ||
    message.includes("exceeded")
  );
}

function isObjectGenerationError(error: unknown): boolean {
  const message = getNestedMessage(error).toLowerCase();

  return (
    message.includes("no object generated") ||
    message.includes("ai_noobjectgeneratederror") ||
    message.includes("no output generated") ||
    message.includes("ai_nooutputgeneratederror") ||
    message.includes("json parsing failed") ||
    message.includes("could not parse the response")
  );
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const [interviewRow] = await db
      .select({ interview: interviews })
      .from(interviews)
      .innerJoin(
        resumeVersions,
        eq(resumeVersions.id, interviews.resumeVersionId)
      )
      .innerJoin(resumes, eq(resumes.id, resumeVersions.resumeId))
      .where(and(eq(interviews.id, id), eq(resumes.userId, userId)));

    const interview = interviewRow?.interview;
    if (!interview || interview.status !== "active") {
      return NextResponse.json(
        { error: "Interview not found or not active" },
        { status: 404 }
      );
    }

    const [existingNext] = await db
      .select()
      .from(interviewQuestions)
      .where(
        and(
          eq(interviewQuestions.interviewId, id),
          isNull(interviewQuestions.answeredAt)
        )
      )
      .orderBy(asc(interviewQuestions.questionIndex))
      .limit(1);

    if (existingNext) {
      return NextResponse.json({
        id: existingNext.id,
        questionIndex: existingNext.questionIndex,
        questionType: existingNext.questionType,
        topic: existingNext.topic,
        question: existingNext.question,
        tip: existingNext.tip,
      });
    }

    const answeredQuestions = await db
      .select()
      .from(interviewQuestions)
      .where(
        and(
          eq(interviewQuestions.interviewId, id),
          isNotNull(interviewQuestions.answeredAt)
        )
      );

    if (answeredQuestions.length >= interview.questionCount) {
      return NextResponse.json({ done: true });
    }

    const [resumeVersion] = await db
      .select()
      .from(resumeVersions)
      .where(eq(resumeVersions.id, interview.resumeVersionId));

    const allQuestions = await db
      .select()
      .from(interviewQuestions)
      .where(eq(interviewQuestions.interviewId, id))
      .orderBy(asc(interviewQuestions.questionIndex));

    const recentAnswered = allQuestions
      .filter((q) => q.answeredAt && q.answerText)
      .slice(-3)
      .map((q) => ({ question: q.question, answer: q.answerText! }));

    const truncatedText = (resumeVersion?.extractedText ?? "").slice(0, 8000);
    const resumeDataStr = JSON.stringify(resumeVersion?.parsedJson).slice(
      0,
      8000
    );

    let prompt = `候选人简历（结构化数据）：
${resumeDataStr}

候选人简历（原文）：
${truncatedText}

面试配置：
- 难度级别：${interview.level}
- 面试类型：${interview.type}
- 面试官角色：${interview.persona}
- 语言：${interview.language}
- 生成数量：1`;

    if (recentAnswered.length > 0) {
      prompt += `\n\n已有问答记录：\n${recentAnswered
        .map((h, i) => `Q${i + 1}: ${h.question}\nA${i + 1}: ${h.answer}`)
        .join("\n\n")}`;
    }

    if (interview.language !== "zh") {
      prompt += `\n\n请用${interview.language}语言生成面试问题。`;
    }

    const maxIndex = allQuestions.reduce(
      (max, q) => Math.max(max, q.questionIndex),
      0
    );

    const { object: generated } = await generateObject({
      model: chatLanguageModel,
      schema: generatedQuestionSchema,
      maxRetries: 2,
      system:
        "你是专业的AI面试官。根据候选人的简历背景生成面试问题。问题必须与简历中的经验和技能相关。根据面试类型（行为/技术/混合）和难度级别生成合适的问题。每个问题需附带一条实用的回答建议。不得虚构简历中不存在的信息。只生成一个问题。输出必须是严格JSON对象，且只能包含 questionType、topic、question、tip 这4个字段。不要使用Markdown，不要输出代码块，不要添加解释文本。",
      prompt,
    });

    const [savedQuestion] = await db
      .insert(interviewQuestions)
      .values({
        interviewId: id,
        questionIndex: maxIndex + 1,
        questionType: generated.questionType,
        topic: generated.topic,
        question: generated.question,
        tip: generated.tip,
      })
      .returning();

    return NextResponse.json({
      id: savedQuestion.id,
      questionIndex: savedQuestion.questionIndex,
      questionType: savedQuestion.questionType,
      topic: savedQuestion.topic,
      question: savedQuestion.question,
      tip: savedQuestion.tip,
    });
  } catch (error) {
    if (isRateLimitError(error)) {
      return NextResponse.json(
        {
          error: "AI_RATE_LIMIT_EXCEEDED",
          message:
            "AI 题目生成频率或额度已达上限，请稍后重试或切换模型。",
        },
        { status: 429 }
      );
    }

    if (isObjectGenerationError(error)) {
      return NextResponse.json(
        {
          error: "AI_NO_OUTPUT",
          message: "AI 未生成可解析的题目结构，请重试。",
        },
        { status: 503 }
      );
    }

    console.error("Error streaming next question:", error);
    return NextResponse.json(
      { error: "Failed to stream next question" },
      { status: 500 }
    );
  }
}
