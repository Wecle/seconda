import assert from "node:assert/strict";
import { nextReconnectDelay } from "@/lib/interview/agent/client-stream";
import type { AgentExitReason } from "@/lib/interview/agent/contracts";
import { createInMemoryInterviewAgentRepository } from "@/lib/interview/agent/repository";

const failureReasons: AgentExitReason[] = [
  "max_turns",
  "aborted_streaming",
  "aborted_tools",
  "hook_stopped",
  "blocking_limit",
  "prompt_too_long",
];

async function main() {
  for (const exitReason of failureReasons) {
    const repository = createInMemoryInterviewAgentRepository();
    const run = await repository.createRun({
      interviewId: `interview:${exitReason}`,
      idempotencyKey: "failure-contract",
    });
    await repository.terminateRun(run.id, {
      exitReason,
      error: new Error(`Injected ${exitReason}`),
    });
    const terminalEvents = (await repository.listEvents(run.id, 0)).filter(
      (event) => event.type === "run_completed" || event.type === "run_failed",
    );
    assert.equal(terminalEvents.length, 1, `${exitReason} terminal event count`);
    assert.equal(terminalEvents[0].type, "run_failed", `${exitReason} terminal type`);
    assert.equal((await repository.getRun(run.id))?.status, "failed");
    assert.equal(nextReconnectDelay(5, () => 0.5), null);
  }
  process.stdout.write(`Validated ${failureReasons.length} Agent failure exits.\n`);
}

void main();
