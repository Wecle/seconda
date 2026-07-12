import { and, asc, count, eq, isNotNull } from "drizzle-orm";
import type { ParsedResume } from "@/lib/resume/types";
import { interviewQuestions, interviews, questionScores, resumeVersions } from "@/lib/db/schema";
import { generateInterviewReport } from "./index";

type Database = typeof import("@/lib/db").db;

export async function completeInterviewReport(database: Database, interviewId: string) {
  const [interview] = await database.select().from(interviews)
    .where(eq(interviews.id, interviewId)).limit(1);
  if (!interview) throw new Error("Interview not found");
  if (interview.status === "completed" && interview.reportJson) return interview.reportJson;
  if (interview.status !== "reporting") throw new Error("Interview must be reporting before report generation");
  try {
    const rows = await database.select({ question: interviewQuestions, score: questionScores })
      .from(interviewQuestions)
      .innerJoin(questionScores, eq(questionScores.questionId, interviewQuestions.id))
      .where(eq(interviewQuestions.interviewId, interviewId))
      .orderBy(asc(interviewQuestions.questionIndex));
    const [answered] = await database.select({ count: count() }).from(interviewQuestions)
      .where(and(eq(interviewQuestions.interviewId, interviewId), isNotNull(interviewQuestions.answeredAt)));
    const answeredCount = Number(answered?.count ?? 0);
    const reportQuestions = rows.filter(({ question }) => Boolean(question.answerText?.trim()))
      .map(({ question, score }) => ({
        question: question.question,
        answer: question.answerText!,
        scores: {
          understanding: score.understanding,
          expression: score.expression,
          logic: score.logic,
          depth: score.depth,
          authenticity: score.authenticity,
          reflection: score.reflection,
          overall: score.overall,
        },
      }));
    if (reportQuestions.length !== answeredCount) {
      throw new Error("Cannot generate report while answered questions remain unscored");
    }
    if (answeredCount === 0) {
      const report = {
        overallScore: 0,
        dimensions: { understanding: 0, expression: 0, logic: 0, depth: 0, authenticity: 0, reflection: 0 },
        topStrengths: [],
        criticalFocus: ["尚无可评估的完整回答"],
        summary: "本次面试在产生可评分回答前结束。",
        nextSteps: ["重新开始一次面试，并至少完成一轮回答后再查看能力评估。"],
      };
      await persistCompletedReport(database, interviewId, report);
      return report;
    }
    const [resumeVersion] = await database.select({ parsedJson: resumeVersions.parsedJson })
      .from(resumeVersions).where(eq(resumeVersions.id, interview.resumeVersionId)).limit(1);
    const resume = resumeVersion?.parsedJson as ParsedResume | null;
    const report = await generateInterviewReport({
      questions: reportQuestions,
      level: interview.configVersion === 2 ? "adaptive" : interview.level,
      type: interview.configVersion === 2 ? "agent" : interview.type,
      language: interview.language,
      resumeSummary: resume ? `${resume.name} - ${resume.title}. Skills: ${resume.skills.join(", ")}` : "",
    });
    await persistCompletedReport(database, interviewId, report);
    return report;
  } catch (error) {
    await database.update(interviews).set({ status: "failed", updatedAt: new Date() })
      .where(and(eq(interviews.id, interviewId), eq(interviews.status, "reporting")));
    throw error;
  }
}

async function persistCompletedReport(database: Database, interviewId: string, report: { overallScore: number }) {
  await database.update(interviews).set({
    status: "completed",
    completedAt: new Date(),
    overallScore: report.overallScore,
    reportJson: report,
    updatedAt: new Date(),
  }).where(and(eq(interviews.id, interviewId), eq(interviews.status, "reporting")));
}
