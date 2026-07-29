import assert from "node:assert/strict";
import test from "node:test";

import {
  hashTurnProposalPrefix,
  type TurnProposalPrefix,
} from "@/lib/interview/agent/domain/turn-proposal";
import {
  assertMatchingCandidateAnswer,
  buildTerminalPayload,
  parseAuthorizedProposal,
} from "@/lib/interview/agent/persistence/invariants";
import { AgentRequestConflictError } from "@/lib/interview/agent/protocols/errors";

function validProposalPrefix(): TurnProposalPrefix {
  return {
    assessment: null,
    coverageChanges: [],
    decision: {
      action: "ask",
      category: "introduction",
      intent: "new_topic",
      evidenceIds: [],
      coverageTarget: "目标岗位和自我介绍",
      estimatedInformationGain: "high",
    },
  };
}

test("rejects a stale proposal hash and the reserved category topic", () => {
  const proposal = validProposalPrefix();
  assert.throws(
    () => parseAuthorizedProposal(proposal, "stale"),
    /hash is stale/i,
  );

  const reservedProposal: TurnProposalPrefix = {
    ...proposal,
    coverageChanges: [{
      category: "resume_project",
      topic: "__category__",
      status: "partial",
      resumeEvidenceIds: [],
    }],
  };
  assert.throws(
    () => parseAuthorizedProposal(
      reservedProposal,
      hashTurnProposalPrefix(reservedProposal),
    ),
    /Reserved coverage topic/i,
  );
});

test("builds one validated terminal payload policy", () => {
  assert.deepEqual(buildTerminalPayload("run-1", {
    exitReason: "aborted_streaming",
  }), {
    runId: "run-1",
    exitReason: "aborted_streaming",
    retryable: true,
    userMessage: "模型连接中断，请重试本轮回答。",
  });
});

test("accepts identical idempotent answer content", () => {
  assert.doesNotThrow(() => {
    assertMatchingCandidateAnswer("回答", "回答");
  });
});

test("rejects a reused answer key with different content", () => {
  assert.throws(
    () => assertMatchingCandidateAnswer("旧回答", "新回答"),
    AgentRequestConflictError,
  );
});
