import { getCurrentUserId } from "@/lib/auth/session";
import { findRunningAgentRun } from "@/lib/agent/repository";
import { cancelActiveRun } from "@/lib/agent/run-registry";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getCurrentUserId();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const run = await findRunningAgentRun(userId, id);
  if (!run) return Response.json({ error: "No active run" }, { status: 404 });
  if (!cancelActiveRun(run.id)) {
    return Response.json({ error: "Run is active on another server instance" }, { status: 409 });
  }
  return Response.json({ cancelled: true });
}
