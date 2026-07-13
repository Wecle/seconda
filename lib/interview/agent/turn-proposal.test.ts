import assert from "node:assert/strict";
import test from "node:test";

import {
  hashTurnProposalPrefix,
  readTurnProposalProgress,
  turnProposalPrefixSchema,
} from "./turn-proposal";

function validAssessment() {
  return {
    completeness: "high" as const,
    specificity: "medium" as const,
    evidenceStrength: "strong" as const,
    reflectionDepth: "surface" as const,
    followUpNeeded: true,
    missingPoints: ["触发阈值"],
    extractedEvidence: ["30 秒后自动降级"],
    publicSummary: "回答包含明确机制，但触发条件仍需追问。",
  };
}

function validQuestionPrefix() {
  return {
    assessment: validAssessment(),
    coverageChanges: [{
      category: "technical_depth" as const,
      topic: "降级机制",
      status: "partial" as const,
      resumeEvidenceIds: ["evidence-1"],
    }],
    decision: {
      action: "ask" as const,
      category: "technical_depth" as const,
      intent: "follow_up" as const,
      evidenceIds: ["evidence-1"],
      coverageTarget: "验证自动降级的触发条件",
      estimatedInformationGain: "high" as const,
    },
  };
}

function validOpeningPrefix() {
  return {
    assessment: null,
    coverageChanges: [],
    decision: {
      action: "clarify" as const,
      category: "career_motivation" as const,
      intent: "verify_evidence" as const,
      evidenceIds: ["evidence-role"],
      coverageTarget: "确认目标岗位",
      estimatedInformationGain: "high" as const,
    },
  };
}

test("requires a complete prefix before response text", () => {
  assert.deepEqual(readTurnProposalProgress({ responseText: "提前输出" }), {
    status: "protocol_violation",
    responseText: "提前输出",
  });

  const progress = readTurnProposalProgress(validQuestionPrefix());
  assert.equal(progress.status, "prefix_ready");
  assert.equal(progress.responseText, "");
});

test("keeps accumulating while a prefix is incomplete and response text is empty", () => {
  assert.deepEqual(readTurnProposalProgress({
    assessment: validAssessment(),
    responseText: "",
  }), { status: "accumulating" });
  assert.deepEqual(readTurnProposalProgress(undefined), { status: "accumulating" });
});

test("rejects response text when a present prefix is invalid", () => {
  assert.deepEqual(readTurnProposalProgress({
    ...validQuestionPrefix(),
    decision: { ...validQuestionPrefix().decision, evidenceIds: [] },
    unexpected: true,
    responseText: "现在已经开始提问？",
  }), {
    status: "protocol_violation",
    responseText: "现在已经开始提问？",
  });
});

test("treats a non-string response text field as a protocol violation", () => {
  assert.deepEqual(readTurnProposalProgress({
    ...validQuestionPrefix(),
    responseText: { secret: "never echo this" },
  }), {
    status: "protocol_violation",
    responseText: "[invalid-response-text]",
  });
});

test("returns normalized prefix and current response text", () => {
  const progress = readTurnProposalProgress({
    ...validQuestionPrefix(),
    coverageChanges: [{
      ...validQuestionPrefix().coverageChanges[0],
      topic: "  降级机制  ",
    }],
    decision: {
      ...validQuestionPrefix().decision,
      coverageTarget: "  验证自动降级的触发条件  ",
    },
    responseText: "问题正文",
  });

  assert.equal(progress.status, "prefix_ready");
  if (progress.status !== "prefix_ready") return;
  assert.equal(progress.prefix.coverageChanges[0]?.topic, "降级机制");
  assert.equal(progress.prefix.decision.action, "ask");
  assert.equal(progress.prefix.decision.coverageTarget, "验证自动降级的触发条件");
  assert.equal(progress.responseText, "问题正文");
});

test("hashes normalized prefixes deterministically", () => {
  const prefix = turnProposalPrefixSchema.parse(validOpeningPrefix());
  assert.equal(
    hashTurnProposalPrefix(prefix),
    hashTurnProposalPrefix(structuredClone(prefix)),
  );
  assert.equal(
    hashTurnProposalPrefix({
      ...validOpeningPrefix(),
      decision: {
        ...validOpeningPrefix().decision,
        coverageTarget: "  确认目标岗位  ",
      },
    }),
    hashTurnProposalPrefix(prefix),
  );
  assert.match(hashTurnProposalPrefix(prefix), /^[a-f0-9]{64}$/);
});
