import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createInterviewMessageElementRegistry } from "./interview-message-element-registry";

test("registers, reads, and unregisters message elements", () => {
  const registry = createInterviewMessageElementRegistry<object>();
  const question = {};

  registry.register("question", question);
  assert.equal(registry.get("question"), question);

  registry.unregister("question");
  assert.equal(registry.get("question"), null);
});

test("cleans up an optimistic element before registering its durable replacement", () => {
  const registry = createInterviewMessageElementRegistry<object>();
  const optimisticAnswer = {};
  const durableAnswer = {};

  registry.register("local-answer", optimisticAnswer);
  registry.unregister("local-answer");
  registry.register("durable-answer", durableAnswer);

  assert.equal(registry.get("local-answer"), null);
  assert.equal(registry.get("durable-answer"), durableAnswer);
});

test("transcript messages expose stable observer targets through the registry callback", () => {
  const source = readFileSync(
    new URL("./agent-interview-room.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /ref=\{\(element\) => registerMessageElement\(message\.id, element\)\}/,
  );
  assert.match(source, /data-message-id=\{message\.id\}/);
});
