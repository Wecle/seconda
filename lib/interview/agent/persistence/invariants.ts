import {
  hashTurnProposalPrefix,
  turnProposalPrefixSchema,
  type TurnProposalPrefix,
} from "@/lib/interview/agent/domain/turn-proposal";
import { agentExitMessage } from "@/lib/interview/agent/protocols/exit-messages";
import { AgentRequestConflictError } from "@/lib/interview/agent/protocols/errors";
import {
  terminalRunPayloadSchema,
  type AgentExitReason,
  type TerminalRunPayload,
} from "@/lib/interview/agent/protocols/runtime";

export function parseAuthorizedProposal(
  proposal: TurnProposalPrefix,
  proposalHash: string,
): TurnProposalPrefix {
  const normalized = turnProposalPrefixSchema.parse(proposal);
  if (hashTurnProposalPrefix(normalized) !== proposalHash) {
    throw new Error("Agent proposal hash is stale");
  }
  if (normalized.coverageChanges.some((change) => change.topic === "__category__")) {
    throw new Error("Reserved coverage topic cannot be proposed");
  }
  return normalized;
}

export function buildTerminalPayload(
  runId: string,
  input: {
    exitReason: AgentExitReason;
    retryable?: boolean;
    userMessage?: string;
  },
): TerminalRunPayload {
  return terminalRunPayloadSchema.parse({
    runId,
    exitReason: input.exitReason,
    retryable: input.retryable ?? input.exitReason === "aborted_streaming",
    userMessage: input.userMessage ?? agentExitMessage(input.exitReason),
  });
}

export function assertMatchingCandidateAnswer(
  existingContent: string,
  requestedContent: string,
): void {
  if (existingContent !== requestedContent) {
    throw new AgentRequestConflictError(
      "Idempotency key was already used for a different answer",
    );
  }
}
