import { notFound } from "next/navigation";
import { z } from "zod";
import { auth } from "@/auth";
import { InterviewReportView, type InterviewReportPayload } from "@/components/interview/interview-report-view";
import { getInterviewReport } from "@/app/api/interviews/[id]/report/route";

const interviewIdSchema = z.string().uuid();

export default async function InterviewReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  const parsedId = interviewIdSchema.safeParse((await params).id);
  if (!session?.user?.id || !parsedId.success) notFound();

  const outcome = await getInterviewReport({
    userId: session.user.id,
    interviewId: parsedId.data,
  });

  if (outcome.status === 404) notFound();

  return (
    <InterviewReportView
      interviewId={parsedId.data}
      initialData={outcome.status === 200 ? (outcome.body as unknown as InterviewReportPayload) : null}
    />
  );
}
