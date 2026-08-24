import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth/session";
import { AgentForkLimitError, forkAgentSession, toAgentSessionSummary } from "@/lib/agent/repository";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  let session;
  try {
    session = await forkAgentSession(userId, id);
  } catch (error) {
    if (error instanceof AgentForkLimitError) {
      return NextResponse.json({ error: error.message }, { status: 413 });
    }
    throw error;
  }
  if (!session) return NextResponse.json({ error: "Session not found or currently running" }, { status: 409 });
  return NextResponse.json(toAgentSessionSummary(session), { status: 201 });
}
