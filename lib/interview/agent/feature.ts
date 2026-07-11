export function isInterviewAgentEnabled(env: Record<string, string | undefined> = process.env) {
  return env.INTERVIEW_AGENT_V2_ENABLED !== "false";
}
