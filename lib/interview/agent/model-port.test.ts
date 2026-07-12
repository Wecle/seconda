import assert from "node:assert/strict";
import test from "node:test";
import { agentProviderStepSchema } from "./contracts";
import { createStreamingInterviewAgentModelPort } from "./model-port";

test("provider output requires a tool call", () => {
  assert.equal(agentProviderStepSchema.safeParse({
    type: "tool_call",
    callId: "call-1",
    toolName: "ask_interview_question",
    args: {},
  }).success, true);
  assert.equal(agentProviderStepSchema.safeParse({
    type: "final",
    content: "请自我介绍",
  }).success, false);
});

test("streaming model port rejects a provider final response", async () => {
  const port = createStreamingInterviewAgentModelPort({
    candidates: [{ model: "fast" }],
    classifyError: () => "fatal",
    onAttemptStarted: async () => {},
    streamCandidate: async () => ({
      partialOutputStream: (async function* () {})(),
      output: Promise.resolve({ type: "final", content: "请自我介绍" }),
    }),
  });
  await assert.rejects(port.nextStepStream!({
    runId: "run",
    messages: [],
    tools: [],
    signal: new AbortController().signal,
    onProviderProgress: async () => {},
    onProvisionalDelta: async () => {},
  }));
});

test("emits only growing question suffixes with one provisional identity", async () => {
  const deltas: Array<{ messageId: string; attemptId: string; text: string }> = [];
  const port = createStreamingInterviewAgentModelPort({
    candidates: [{ model: "fast" }],
    classifyError: () => "fatal",
    createAttemptId: () => "attempt-1",
    createMessageId: () => "message-1",
    onAttemptStarted: async () => {},
    streamCandidate: async () => ({
      partialOutputStream: (async function* () {
        yield { type: "tool_call", args: { question: "请" } };
        yield { type: "tool_call", args: { question: "请介绍" } };
        yield { type: "tool_call", args: { question: "请介绍" } };
      })(),
      output: Promise.resolve({
        type: "tool_call",
        callId: "call-1",
        toolName: "ask_interview_question",
        args: { question: "请介绍" },
      }),
    }),
  });
  const result = await port.nextStepStream!({
    runId: "run",
    messages: [],
    tools: [],
    signal: new AbortController().signal,
    onProviderProgress: async () => {},
    onProvisionalDelta: async (delta) => { deltas.push(delta); },
  });
  assert.deepEqual(deltas.map((delta) => delta.text), ["请", "介绍"]);
  assert.equal(result.provisionalMessageId, "message-1");
  assert.equal(result.attemptId, "attempt-1");
});

test("aborts an idle provider stream", async () => {
  const port = createStreamingInterviewAgentModelPort({
    candidates: [{ model: "fast" }],
    classifyError: () => "fatal",
    idleTimeoutMs: 5,
    onAttemptStarted: async () => {},
    streamCandidate: async () => ({
      partialOutputStream: (async function* () {
        await new Promise(() => {});
      })(),
      output: new Promise(() => {}),
    }),
  });
  await assert.rejects(port.nextStepStream!({
    runId: "run",
    messages: [],
    tools: [],
    signal: new AbortController().signal,
    onProviderProgress: async () => {},
    onProvisionalDelta: async () => {},
  }), (error: unknown) => {
    assert.equal((error as { code?: string }).code, "PROVIDER_IDLE_TIMEOUT");
    return true;
  });
});

test("does not fall back after a provisional delta", async () => {
  const calls: string[] = [];
  const port = createStreamingInterviewAgentModelPort({
    candidates: [{ model: "fast" }, { model: "quality" }],
    classifyError: () => "transient",
    onAttemptStarted: async () => {},
    streamCandidate: async ({ model }) => {
      calls.push(model);
      return {
        partialOutputStream: (async function* () {
          yield { type: "tool_call", args: { question: "已经展示" } };
          throw new Error("broken");
        })(),
        output: Promise.reject(new Error("broken")),
      };
    },
  });
  await assert.rejects(port.nextStepStream!({
    runId: "run",
    messages: [],
    tools: [],
    signal: new AbortController().signal,
    onProviderProgress: async () => {},
    onProvisionalDelta: async () => {},
  }), (error: unknown) => (error as { code?: string }).code === "PROVISIONAL_STREAM_ABORTED");
  assert.deepEqual(calls, ["fast"]);
});
