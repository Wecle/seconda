import assert from "node:assert/strict";
import test from "node:test";
import { AgentCapabilityRegistry } from "./capabilities/registry";
import { workspaceCapability } from "./capabilities/workspace/capability";
import type { AgentCapability, CapabilityContext } from "./capabilities/types";

function stubCapability(id: string): AgentCapability {
  return {
    id,
    promptVersion: "test-v1",
    maxSteps: 1,
    createContextProviders: () => [],
    createToolRegistry: () => ({ schemas: () => [], toAISDKTools: () => ({}) }),
  };
}

function workspaceContext(workspaceRoot: string | null): CapabilityContext {
  return {
    sessionId: "session",
    runId: "run",
    userId: "user",
    model: "test/model",
    systemPrompt: "workspace contract",
    promptVersion: workspaceCapability.promptVersion,
    capabilityConfig: { workspaceRoot },
    state: new Map(),
    signal: new AbortController().signal,
    events: { append: async () => { throw new Error("not used"); } },
  };
}

test("capability registry rejects duplicates and unknown ids without fallback", () => {
  const registry = new AgentCapabilityRegistry();
  const release = registry.register(stubCapability("custom"));
  assert.equal(registry.resolve("custom").id, "custom");
  assert.throws(() => registry.register(stubCapability("custom")), /already registered/);
  assert.throws(() => registry.resolve("missing"), /Unknown agent capability/);
  release();
  assert.throws(() => registry.resolve("custom"), /Unknown agent capability/);
  const replacement = stubCapability("custom");
  registry.register(replacement);
  release();
  assert.equal(registry.resolve("custom"), replacement);
});

test("workspace capability owns its prompt context, tools, and continuation policy", async () => {
  const context = workspaceContext(process.cwd());
  const providers = workspaceCapability.createContextProviders(context);
  assert.deepEqual(providers.map(({ id }) => id), ["persona", "workspace"]);
  assert.deepEqual(workspaceCapability.createToolRegistry(context).schemas().map(({ name }) => name), [
    "list_files",
    "read_file",
    "search_files",
  ]);
  assert.deepEqual(await workspaceCapability.afterStep?.({ ...context, step: 1, content: [{ type: "tool-result" }] }), {
    action: "continue",
  });
  assert.throws(() => workspaceCapability.createToolRegistry(workspaceContext(null)), /requires a workspace root/);
});
