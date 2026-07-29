import type { AgentExitReason } from "@/lib/interview/agent/protocols/runtime";
import type { RunLeaseToken } from "@/lib/interview/agent/persistence/repository";

export interface AgentRunExecutor {
  run(input: {
    interviewId: string;
    runId: string;
    mode: "opening" | "answer";
    instruction: string;
    signal: AbortSignal;
    lease: RunLeaseToken;
  }): Promise<{ exitReason: AgentExitReason }>;
}

export interface AgentRunScheduler {
  schedule(runId: string): Promise<void>;
}
