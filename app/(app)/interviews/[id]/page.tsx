import { notFound } from "next/navigation";
import { z } from "zod";
import { auth } from "@/auth";
import { InterviewRoom } from "@/components/interview/interview-room";
import { getInterviewRoom } from "@/lib/interview/application/get-interview-room";

const interviewIdSchema = z.string().uuid();

export default async function InterviewRoomPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  const parsedId = interviewIdSchema.safeParse((await params).id);
  if (!session?.user?.id || !parsedId.success) notFound();

  const view = await getInterviewRoom({
    userId: session.user.id,
    interviewId: parsedId.data,
  });
  if (!view) notFound();

  return <InterviewRoom view={view} user={session.user} />;
}
