import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth/session";
import { AgentForkLimitError, forkAgentSession, toAgentSessionSummary } from "@/lib/agent/repository";
import { BUILT_IN_CAPABILITIES } from "@/lib/agent/capabilities/types";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await request.json().catch(() => ({})) as { upToSequence?: unknown };
  const upToSequence = typeof body.upToSequence === "number" && Number.isSafeInteger(body.upToSequence) && body.upToSequence > 0
    ? body.upToSequence
    : undefined;

  let session;
  try {
    session = await forkAgentSession(userId, id, BUILT_IN_CAPABILITIES.workspace, { upToSequence });
  } catch (error) {
    if (error instanceof AgentForkLimitError) {
      return NextResponse.json({ error: error.message }, { status: 413 });
    }
    throw error;
  }
  if (!session) return NextResponse.json({ error: "Session not found or currently running" }, { status: 409 });
  return NextResponse.json(toAgentSessionSummary(session), { status: 201 });
}
