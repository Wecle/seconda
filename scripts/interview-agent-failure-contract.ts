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
    const terminalEvents = (await repository.listEvents(run.id, 0, { visibility: "public" })).filter(
      (event) => event.type === "run_completed" || event.type === "run_failed",
    );
    const publicEvents = await repository.listEvents(run.id, 0, { visibility: "public" });
    assert.equal(terminalEvents.length, 1, `${exitReason} terminal event count`);
    assert.equal(terminalEvents[0].type, "run_failed", `${exitReason} terminal type`);
    assert.equal(publicEvents.at(-1)?.type, "run_failed", `${exitReason} terminal event order`);
    assert.equal(publicEvents.some((event) => event.type === "text_delta"), false);
    assert.equal(new Set(publicEvents.map((event) => event.sequence)).size, publicEvents.length);
    assert.equal(
      publicEvents.every((event, index) => index === 0 || event.sequence > publicEvents[index - 1].sequence),
      true,
      `${exitReason} public sequence order`,
    );
    assert.equal((await repository.getRun(run.id))?.status, "failed");
    assert.equal(nextReconnectDelay(5, () => 0.5), null);
  }
  process.stdout.write(`Validated ${failureReasons.length} Agent failure exits.\n`);
}

void main();
