import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUserId } from "@/lib/auth/session";
import { loadModelPolicy } from "@/lib/ai/model-policy";
import { DEFAULT_AGENT_SYSTEM_PROMPT } from "@/lib/agent/prompt";
import { createAgentSession, listAgentSessions, toAgentSessionSummary } from "@/lib/agent/repository";

const createSessionSchema = z.object({
  title: z.string().trim().min(1).max(100).optional(),
});

export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await listAgentSessions(userId));
}

export async function POST(request: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = createSessionSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid session settings" }, { status: 400 });
  }

  try {
    const policy = loadModelPolicy();
    const session = await createAgentSession({
      userId,
      title: parsed.data.title ?? "New agent task",
      model: policy.qualityModel,
      systemPrompt: DEFAULT_AGENT_SYSTEM_PROMPT,
      workspaceRoot: process.cwd(),
    });
    return NextResponse.json(toAgentSessionSummary(session), { status: 201 });
  } catch (error) {
    console.error("Failed to create agent session", error);
    return NextResponse.json({ error: "Agent model is not configured" }, { status: 500 });
  }
}
