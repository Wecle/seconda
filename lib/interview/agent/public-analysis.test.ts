import assert from "node:assert/strict";
import test from "node:test";

import { z } from "zod";

import {
  readPublicAnalysisDelta,
  stripPublicAnalysis,
  withPublicAnalysis,
} from "./public-analysis";

test("adds required public analysis without weakening the business schema", () => {
  const business = z.object({ limit: z.number().int() }).strict();
  const provider = withPublicAnalysis(business, "read");

  assert.equal(provider.safeParse({
    publicAnalysis: "先回顾已提交记录。",
    limit: 5,
  }).success, true);
  assert.equal(provider.safeParse({ limit: 5 }).success, false);
  assert.equal(provider.safeParse({
    publicAnalysis: "先回顾记录。",
    limit: 5,
    extra: true,
  }).success, false);
});

test("returns only the suffix of a cumulative public analysis field", () => {
  assert.deepEqual(
    readPublicAnalysisDelta({ publicAnalysis: "先核对简历证据。" }, "先核对"),
    { status: "delta", fullText: "先核对简历证据。", delta: "简历证据。" },
  );
  assert.deepEqual(
    readPublicAnalysisDelta({ publicAnalysis: "改写方向" }, "先核对"),
    { status: "rewritten" },
  );
});

test("strips public analysis before business parsing", () => {
  assert.deepEqual(
    stripPublicAnalysis({ publicAnalysis: "检查覆盖度。", limit: 5 }),
    { publicAnalysis: "检查覆盖度。", businessInput: { limit: 5 } },
  );
});
