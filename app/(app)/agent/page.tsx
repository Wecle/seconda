import type { Metadata } from "next";
import { getCurrentUserId } from "@/lib/auth/session";
import { listAgentSessions, listAgentUiEvents } from "@/lib/agent/repository";
import { BUILT_IN_CAPABILITIES } from "@/lib/agent/capabilities/types";
import { AgentWorkspace } from "@/components/agent/agent-workspace";

export const metadata: Metadata = {
  title: "Agent Workspace",
  description: "Inspect an event-sourced autonomous agent run in real time.",
};

export default async function AgentPage() {
  const userId = await getCurrentUserId();
  const sessions = userId
    ? await listAgentSessions(userId, BUILT_IN_CAPABILITIES.workspace)
    : [];
  const firstSession = sessions[0] ?? null;
  const initialEvents = userId && firstSession
    ? await listAgentUiEvents(
        userId,
        firstSession.id,
        undefined,
        BUILT_IN_CAPABILITIES.workspace,
      )
    : [];
  return (
    <AgentWorkspace
      initialSessions={sessions}
      initialDetail={firstSession && initialEvents ? { session: firstSession, events: initialEvents } : null}
    />
  );
}
