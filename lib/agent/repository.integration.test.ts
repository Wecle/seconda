import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";
import { agentEvents, agentSessions, users } from "@/lib/db/schema";

test("atomic compaction commit lands a complete replacement lifecycle", {
  skip: process.env.DATABASE_URL ? false : "DATABASE_URL is not configured",
}, async () => {
  const client = postgres(process.env.DATABASE_URL!, { prepare: false });
  const database = drizzle(client, { schema });
  const { appendAgentEvent, appendAgentEventsAtomically, loadAgentEvents } = await import("./repository");
  const userId = randomUUID();
  let sessionId = "";
  try {
    await database.insert(users).values({ id: userId, email: `${userId}@example.test` });
    const [session] = await database.insert(agentSessions).values({
      userId,
      title: "Compaction integration",
      model: "deepseek/deepseek-chat",
      systemPrompt: "test",
      workspaceRoot: process.cwd(),
    }).returning();
    sessionId = session.id;
    await appendAgentEvent({ sessionId, type: "user_message", payload: { message: { role: "user", content: "old" } } });
    await appendAgentEvent({ sessionId, type: "compaction_started", payload: { compactionId: "compact-1" } });
    const committed = await appendAgentEventsAtomically({
      sessionId,
      events: [
        { type: "compaction_summary", payload: { compactionId: "compact-1", summary: "old goal" } },
        { type: "model_context_replaced", payload: { compactionId: "compact-1", shadowedSequences: [1], message: { role: "user", content: "summary" } } },
        { type: "compaction_completed", payload: { compactionId: "compact-1" } },
      ],
    });
    assert.deepEqual(committed.map(({ sequence }) => sequence), [3, 4, 5]);
    const events = await loadAgentEvents(sessionId);
    assert.deepEqual(events.map(({ sequence }) => sequence), [1, 2, 3, 4, 5]);
    assert.equal(events[3].type, "model_context_replaced");
  } finally {
    try {
      if (sessionId) await database.delete(agentEvents).where(eq(agentEvents.sessionId, sessionId));
      await database.delete(users).where(eq(users.id, userId));
    } finally {
      await client.end();
    }
  }
});

test("fork copies a stable event prefix and appends lineage", {
  skip: process.env.DATABASE_URL ? false : "DATABASE_URL is not configured",
}, async () => {
  const client = postgres(process.env.DATABASE_URL!, { prepare: false });
  const database = drizzle(client, { schema });
  const { appendAgentEvent, forkAgentSession, loadAgentEvents } = await import("./repository");
  const userId = randomUUID();
  let sourceId = "";
  let childId = "";
  try {
    await database.insert(users).values({ id: userId, email: `${userId}@example.test` });
    const [source] = await database.insert(agentSessions).values({
      userId, title: "Fork source", model: "deepseek/deepseek-chat",
      systemPrompt: "test", workspaceRoot: process.cwd(),
    }).returning();
    sourceId = source.id;
    await appendAgentEvent({ sessionId: sourceId, type: "user_message", payload: { message: { role: "user", content: "continue this" } } });
    const child = await forkAgentSession(userId, sourceId);
    assert.ok(child);
    childId = child.id;
    const events = await loadAgentEvents(childId);
    assert.deepEqual(events.map((event) => event.sequence), [1, 2]);
    assert.equal(events[0].type, "user_message");
    assert.equal(events[1].type, "session_forked");
    assert.deepEqual(events[1].payload, { parentSessionId: sourceId, boundarySequence: 1 });
  } finally {
    try {
      if (childId) await database.delete(agentEvents).where(eq(agentEvents.sessionId, childId));
      if (sourceId) await database.delete(agentEvents).where(eq(agentEvents.sessionId, sourceId));
      await database.delete(users).where(eq(users.id, userId));
    } finally {
      await client.end();
    }
  }
});

test("event history paginates without dropping the 1000-row boundary", {
  skip: process.env.DATABASE_URL ? false : "DATABASE_URL is not configured",
}, async () => {
  const client = postgres(process.env.DATABASE_URL!, { prepare: false });
  const database = drizzle(client, { schema });
  const { listAgentEvents } = await import("./repository");
  const userId = randomUUID();
  let sessionId = "";
  try {
    await database.insert(users).values({ id: userId, email: `${userId}@example.test` });
    const [session] = await database.insert(agentSessions).values({
      userId, title: "Pagination", model: "deepseek/deepseek-chat",
      systemPrompt: "test", workspaceRoot: process.cwd(), nextEventSequence: 1_002,
    }).returning();
    sessionId = session.id;
    await database.insert(agentEvents).values(Array.from({ length: 1_001 }, (_, index) => ({
      sessionId, sequence: index + 1, type: "request_context" as const, payload: { index },
    })));
    const first = await listAgentEvents(userId, sessionId, 0);
    assert.equal(first?.length, 1_000);
    assert.equal(first?.at(-1)?.sequence, 1_000);
    const second = await listAgentEvents(userId, sessionId, 1_000);
    assert.deepEqual(second?.map((event) => event.sequence), [1_001]);
  } finally {
    try {
      if (sessionId) await database.delete(agentEvents).where(eq(agentEvents.sessionId, sessionId));
      await database.delete(users).where(eq(users.id, userId));
    } finally {
      await client.end();
    }
  }
});
