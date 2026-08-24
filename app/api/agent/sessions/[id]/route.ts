import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth/session";
import { getAgentSession, listAgentEvents, toAgentSessionSummary } from "@/lib/agent/repository";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const after = Number(new URL(request.url).searchParams.get("after") ?? 0);
  const [session, events] = await Promise.all([
    getAgentSession(userId, id),
    listAgentEvents(userId, id, Number.isSafeInteger(after) && after >= 0 ? after : 0),
  ]);
  if (!session || !events) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  return NextResponse.json({ session: toAgentSessionSummary(session), events });
}
