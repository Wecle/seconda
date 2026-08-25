import assert from "node:assert/strict";
import test from "node:test";
import { createStaticSkillProvider } from "./skills/static-provider";
import { AgentSkillRegistry, SkillRegistryError, skillContentHash } from "./skills/registry";
import { createSkillToolRegistry, SKILL_ALLOWED_STEP, SKILL_LOAD_FAILED } from "./skills/tool";
import { CURRENT_AGENT_STEP } from "./capabilities/types";
import type { AgentEvent, AgentEventType } from "./types";

const discovery = {
  sessionId: "session",
  runId: "run",
  userId: "user",
  capability: "interview",
  allowlist: ["resume-deep-dive", "follow-up-strategy"],
} as const;

test("skill registry snapshots a stable capability-scoped catalog", async () => {
  const registry = new AgentSkillRegistry();
  registry.registerProvider(createStaticSkillProvider("built-ins", [
    { name: "workspace-inspection", description: "Workspace only", version: "1", instructions: "Inspect files." },
    { name: "resume-deep-dive", description: "Resume evidence", version: "1", instructions: "Probe one claim." },
    { name: "follow-up-strategy", description: "Focused follow-up", version: "1", instructions: "Ask one gap." },
  ]));

  const first = await registry.snapshot(discovery);
  const second = await registry.snapshot(discovery);
  assert.deepEqual(first.skills.map(({ name }) => name), ["follow-up-strategy", "resume-deep-dive"]);
  assert.equal(first.catalogHash, second.catalogHash);
  assert.equal(first.skills.some(({ name }) => name === "workspace-inspection"), false);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.skills), true);
});

test("skill registry rejects duplicate providers, duplicate scoped names, and invalid names", async () => {
  const registry = new AgentSkillRegistry();
  const provider = createStaticSkillProvider("built-ins", [
    { name: "resume-deep-dive", description: "Resume evidence", version: "1", instructions: "Probe one claim." },
  ]);
  registry.registerProvider(provider);
  assert.throws(() => registry.registerProvider(provider), /already registered/);
  assert.throws(() => registry.registerProvider({ ...provider, id: "INVALID PROVIDER" }));
  assert.throws(() => createStaticSkillProvider("duplicates", [
    { name: "resume-deep-dive", description: "One", version: "1", instructions: "One." },
    { name: "resume-deep-dive", description: "Two", version: "1", instructions: "Two." },
  ]), /defined more than once/);

  const duplicates = new AgentSkillRegistry();
  duplicates.registerProvider(provider);
  duplicates.registerProvider(createStaticSkillProvider("other", [
    { name: "resume-deep-dive", description: "Duplicate", version: "1", instructions: "Other." },
  ]));
  await assert.rejects(duplicates.snapshot(discovery), /more than once/);
  await assert.rejects(registry.snapshot({ ...discovery, allowlist: ["Not Valid"] }));
});

test("skill loads are fenced to the immutable snapshot", async () => {
  let instructions = "Initial instructions.";
  let available = true;
  const registry = new AgentSkillRegistry();
  registry.registerProvider({
    id: "mutable",
    async snapshot() {
      return {
        complete: true,
        skills: [{
          name: "resume-deep-dive",
          description: "Resume evidence",
          version: "1",
          contentHash: skillContentHash(instructions),
        }],
      };
    },
    async load() {
      return available ? {
        name: "resume-deep-dive",
        description: "Resume evidence",
        version: "1",
        contentHash: skillContentHash(instructions),
        instructions,
      } : null;
    },
  });
  const snapshot = await registry.snapshot(discovery);
  const context = {
    sessionId: "session", runId: "run", userId: "user", capability: "interview",
    snapshot, signal: new AbortController().signal,
  };
  assert.equal((await registry.load("resume-deep-dive", context)).instructions, "Initial instructions.");

  instructions = "Changed after snapshot.";
  await assert.rejects(registry.load("resume-deep-dive", context), (error) => (
    error instanceof SkillRegistryError && error.code === "SKILL_SNAPSHOT_MISMATCH"
  ));
  await assert.rejects(registry.load("workspace-inspection", context), (error) => (
    error instanceof SkillRegistryError && error.code === "SKILL_NOT_VISIBLE"
  ));
  available = false;
  await assert.rejects(registry.load("resume-deep-dive", context), (error) => (
    error instanceof SkillRegistryError && error.code === "SKILL_UNAVAILABLE"
  ));
});

test("skill instructions stay below the first-consumption spill boundary", async () => {
  const instructions = "x".repeat(8_001);
  const registry = new AgentSkillRegistry();
  registry.registerProvider({
    id: "oversized",
    async snapshot() {
      return {
        complete: true,
        skills: [{
          name: "resume-deep-dive", description: "Oversized", version: "1",
          contentHash: skillContentHash(instructions),
        }],
      };
    },
    async load() {
      return {
        name: "resume-deep-dive", description: "Oversized", version: "1",
        contentHash: skillContentHash(instructions), instructions,
      };
    },
  });
  const snapshot = await registry.snapshot(discovery);
  await assert.rejects(registry.load("resume-deep-dive", {
    sessionId: "session", runId: "run", userId: "user", capability: "interview",
    snapshot, signal: new AbortController().signal,
  }), (error) => error instanceof SkillRegistryError && error.code === "INVALID_SKILL");
});

test("skill registry rejects escaped output that crosses the serialized spill boundary", async () => {
  const instructions = "\u0001".repeat(2_000);
  const registry = new AgentSkillRegistry();
  registry.registerProvider({
    id: "escaped-output",
    async snapshot() {
      return {
        complete: true,
        skills: [{
          name: "resume-deep-dive", description: "Escaped", version: "1",
          contentHash: skillContentHash(instructions),
        }],
      };
    },
    async load() {
      return {
        name: "resume-deep-dive", description: "Escaped", version: "1",
        contentHash: skillContentHash(instructions), instructions,
      };
    },
  });
  const snapshot = await registry.snapshot(discovery);
  await assert.rejects(registry.load("resume-deep-dive", {
    sessionId: "session", runId: "run", userId: "user", capability: "interview",
    snapshot, signal: new AbortController().signal,
  }), (error) => error instanceof SkillRegistryError && error.code === "INVALID_SKILL");
});

test("skill tool returns instructions to the model but records metadata-only lifecycle events", async () => {
  const registry = new AgentSkillRegistry();
  registry.registerProvider(createStaticSkillProvider("built-ins", [
    { name: "resume-deep-dive", description: "Resume evidence", version: "1", instructions: "Probe one claim." },
  ]));
  const snapshot = await registry.snapshot(discovery);
  const events: AgentEvent[] = [];
  const state = new Map<PropertyKey, unknown>();
  const tools = createSkillToolRegistry().toAISDKTools({
    sessionId: "session", runId: "run", userId: "user", capability: "interview",
    snapshot, registry, signal: new AbortController().signal, state,
    events: {
      async append(type: AgentEventType, payload: Record<string, unknown>) {
        const event: AgentEvent = {
          id: events.length + 1, sessionId: "session", runId: "run", sequence: events.length + 1,
          type, payload, dedupeKey: null, schemaVersion: 1, visibility: "model", createdAt: new Date(0),
        };
        events.push(event);
        return event;
      },
    },
  });
  const execute = tools.skill.execute;
  assert.ok(execute);
  const output = await execute({ name: "resume-deep-dive" }, {} as never);
  assert.equal((output as { instructions: string }).instructions, "Probe one claim.");
  assert.deepEqual(events.map(({ type }) => type), ["skill_loaded"]);
  assert.equal("instructions" in events[0].payload, false);

  await assert.rejects(execute({ name: "workspace-inspection" }, {} as never));
  assert.equal(events.at(-1)?.type, "skill_load_failed");
  assert.equal(state.get(SKILL_LOAD_FAILED), "SKILL_NOT_VISIBLE");
  assert.equal("instructions" in (events.at(-1)?.payload ?? {}), false);
});

test("capability policy can move a recoverable Skill discovery step", async () => {
  const registry = new AgentSkillRegistry();
  registry.registerProvider(createStaticSkillProvider("built-ins", [
    { name: "resume-deep-dive", description: "Resume evidence", version: "1", instructions: "Probe one claim." },
  ]));
  const snapshot = await registry.snapshot(discovery);
  const state = new Map<PropertyKey, unknown>([
    [CURRENT_AGENT_STEP, 2],
    [SKILL_ALLOWED_STEP, 2],
  ]);
  const execute = createSkillToolRegistry().toAISDKTools({
    sessionId: "session",
    runId: "run",
    userId: "user",
    capability: "interview",
    snapshot,
    registry,
    loadStep: 1,
    state,
    signal: new AbortController().signal,
    events: { append: async () => ({}) as never },
  }).skill.execute;
  assert.ok(execute);
  const result = await execute({ name: "resume-deep-dive" }, {} as never);
  assert.equal((result as { status: string }).status, "loaded");
});
