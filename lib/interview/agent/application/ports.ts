import type { AgentExitReason } from "@/lib/interview/agent/protocols/runtime";
import type { RunLeaseToken } from "@/lib/interview/agent/persistence/repository";
import type { AgentRunMode } from "@/lib/interview/agent/domain/opening-role";

export interface AgentRunExecutor {
  run(input: {
    interviewId: string;
    runId: string;
    mode: AgentRunMode;
    answerMessageId?: string;
    instruction: string;
    signal: AbortSignal;
    lease: RunLeaseToken;
  }): Promise<{ exitReason: AgentExitReason }>;
}

export interface AgentRunScheduler {
  schedule(runId: string): Promise<void>;
}
