import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth/session";
import { getAgentSession, listAgentUiEvents, toAgentSessionSummary } from "@/lib/agent/repository";
import { BUILT_IN_CAPABILITIES } from "@/lib/agent/capabilities/types";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const beforeParam = new URL(request.url).searchParams.get("before");
  const before = beforeParam === null ? undefined : Number(beforeParam);
  if (before !== undefined && (!Number.isSafeInteger(before) || before <= 0)) {
    return NextResponse.json({ error: "Invalid history cursor" }, { status: 400 });
  }
  const [session, events] = await Promise.all([
    getAgentSession(userId, id, BUILT_IN_CAPABILITIES.workspace),
    listAgentUiEvents(userId, id, before, BUILT_IN_CAPABILITIES.workspace),
  ]);
  if (!session || !events) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  return NextResponse.json({
    session: toAgentSessionSummary(session),
    events,
    previousBefore: events[0]?.sequence ?? before ?? null,
    hasOlder: events.length === 1_000,
  });
}
