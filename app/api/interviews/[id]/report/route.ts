import { z } from "zod";
import { getCurrentUserId } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { InterviewApplicationError } from "@/lib/interview/domain/errors";
import { loadInterviewReportData } from "@/lib/interview/persistence/completion-repository";

export const runtime = "nodejs";

const interviewIdSchema = z.string().uuid();

export async function getInterviewReport(input: {
  userId: string;
  interviewId: string;
}, dependencies: { database?: typeof db } = {}) {
  const data = await loadInterviewReportData({
    database: dependencies.database ?? db,
    userId: input.userId,
    interviewId: input.interviewId,
  });

  if (!data) {
    return { status: 404, body: { error: "Interview not found" } };
  }

  if (data.interview.status === "completing" && !data.report) {
    return {
      status: 200,
      body: {
        status: "completing",
        interview: data.interview,
        job: data.job,
      },
    };
  }

  return {
    status: 200,
    body: {
      status: data.interview.status,
      interview: data.interview,
      job: data.job,
      report: data.report,
      questions: data.questions.map((q) => ({
        id: q.id,
        sequence: q.sequence,
        kind: q.kind,
        topic: q.topic,
        question: q.question,
        tip: q.tip,
        status: q.status,
        answer: q.answerContent,
        answerStatus: q.answerStatus,
        scores:
          q.understanding !== null &&
          q.expression !== null &&
          q.logic !== null &&
          q.depth !== null &&
          q.authenticity !== null &&
          q.reflection !== null
            ? {
                understanding: q.understanding,
                expression: q.expression,
                logic: q.logic,
                depth: q.depth,
                authenticity: q.authenticity,
                reflection: q.reflection,
              }
            : null,
        overall: q.overall ? Number(q.overall) : null,
        feedback: q.feedbackJson,
        scoreStatus: q.scoreStatus,
      })),
    },
  };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getCurrentUserId();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const parsedId = interviewIdSchema.safeParse((await params).id);
  if (!parsedId.success) return Response.json({ error: "Interview not found" }, { status: 404 });

  try {
    const result = await getInterviewReport({ userId, interviewId: parsedId.data });
    return Response.json(result.body, { status: result.status });
  } catch (error) {
    if (error instanceof InterviewApplicationError) {
      return Response.json({ error: error.code, message: error.message }, { status: 500 });
    }
    console.error("Failed to load interview report", error);
    return Response.json({ error: "Failed to load report" }, { status: 500 });
  }
}
