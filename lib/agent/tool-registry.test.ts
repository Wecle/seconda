import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { AgentToolRegistry } from "./tool-registry";

function echoDefinition() {
  return {
    name: "echo",
    description: "Echo input",
    inputSchema: z.object({ text: z.string() }),
    outputSchema: z.object({ text: z.string() }),
    async execute(input: unknown) {
      return input;
    },
  };
}

test("projects only model-visible tool schema fields", () => {
  const registry = new AgentToolRegistry();
  registry.register(echoDefinition());
  const [schema] = registry.schemas();
  assert.deepEqual(Object.keys(schema).sort(), ["description", "inputSchema", "name"]);
});

test("rejects duplicate tool registrations", () => {
  const registry = new AgentToolRegistry();
  registry.register(echoDefinition());
  assert.throws(() => registry.register(echoDefinition()), /already registered/);
});

test("blocks repeated identical calls and validates canonical output", async () => {
  const registry = new AgentToolRegistry();
  registry.register(echoDefinition());
  const tools = registry.toAISDKTools({
    workspaceRoot: process.cwd(),
    signal: new AbortController().signal,
  });
  const execute = tools.echo.execute;
  assert.ok(execute);
  const options = {} as Parameters<NonNullable<typeof execute>>[1];
  for (let index = 0; index < 3; index += 1) {
    assert.deepEqual(await execute({ text: "same" }, options), { text: "same" });
  }
  await assert.rejects(execute({ text: "same" }, options), /called repeatedly/);

  const invalidRegistry = new AgentToolRegistry();
  invalidRegistry.register({
    ...echoDefinition(),
    async execute() {
      return { text: 42 };
    },
  });
  const invalidExecute = invalidRegistry.toAISDKTools({
    workspaceRoot: process.cwd(),
    signal: new AbortController().signal,
  }).echo.execute;
  assert.ok(invalidExecute);
  await assert.rejects(invalidExecute({ text: "value" }, {} as never));
});

test("does not start tools after cancellation", async () => {
  const controller = new AbortController();
  controller.abort(new DOMException("Cancelled", "AbortError"));
  const registry = new AgentToolRegistry();
  registry.register(echoDefinition());
  const execute = registry.toAISDKTools({
    workspaceRoot: process.cwd(),
    signal: controller.signal,
  }).echo.execute;
  assert.ok(execute);
  await assert.rejects(execute({ text: "value" }, {} as never), /Cancelled/);
});
