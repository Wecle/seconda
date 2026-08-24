import { and, asc, desc, eq, lt, ne, notInArray, sql } from "drizzle-orm";
import type { ModelMessage } from "ai";
import { db } from "@/lib/db";
import { agentEvents, agentRuns, agentSessions } from "@/lib/db/schema";
import type { AgentEvent, AgentEventType, AgentSessionSummary } from "./types";
import { projectModelInput } from "./model-input";

export { closeDatabaseConnection as closeAgentRepositoryConnection } from "@/lib/db";

export function toAgentSessionSummary(row: typeof agentSessions.$inferSelect): AgentSessionSummary {
  return {
    id: row.id,
    title: row.title,
    model: row.model,
    status: row.status as AgentSessionSummary["status"],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const MAX_FORK_EVENTS = 5_000;
const MAX_FORK_PAYLOAD_BYTES = 16 * 1024 * 1024;

export class AgentForkLimitError extends Error {
  constructor() {
    super("Session is too large to fork safely");
    this.name = "AgentForkLimitError";
  }
}

export async function listAgentSessions(userId: string) {
  let rows = await db
    .select()
    .from(agentSessions)
    .where(eq(agentSessions.userId, userId))
    .orderBy(desc(agentSessions.updatedAt));
  const running = rows.filter((row) => row.status === "running");
  if (running.length > 0) {
    const recovered = await Promise.all(running.map((row) => recoverStaleAgentRun(userId, row.id)));
    if (recovered.some(Boolean)) {
      rows = await db
        .select()
        .from(agentSessions)
        .where(eq(agentSessions.userId, userId))
        .orderBy(desc(agentSessions.updatedAt));
    }
  }
  return rows.map(toAgentSessionSummary);
}

export async function createAgentSession(input: {
  userId: string;
  title: string;
  model: string;
  capability: string;
  promptVersion: string;
  systemPrompt: string;
  workspaceRoot: string | null;
}) {
  const [row] = await db.insert(agentSessions).values(input).returning();
  return row;
}

export async function forkAgentSession(userId: string, sourceSessionId: string) {
  return db.transaction(async (transaction) => {
    const [source] = await transaction.select().from(agentSessions).where(and(
      eq(agentSessions.id, sourceSessionId),
      eq(agentSessions.userId, userId),
      ne(agentSessions.status, "running"),
    )).limit(1).for("update");
    if (!source) return null;
    const [size] = await transaction.select({
      eventCount: sql<number>`count(*)::int`,
      payloadBytes: sql<number>`coalesce(sum(pg_column_size(${agentEvents.payload})), 0)::int`,
    }).from(agentEvents).where(eq(agentEvents.sessionId, sourceSessionId));
    if ((size?.eventCount ?? 0) > MAX_FORK_EVENTS || (size?.payloadBytes ?? 0) > MAX_FORK_PAYLOAD_BYTES) {
      throw new AgentForkLimitError();
    }
    const sourceEvents = await transaction.select().from(agentEvents)
      .where(eq(agentEvents.sessionId, sourceSessionId))
      .orderBy(asc(agentEvents.sequence));
    const boundarySequence = sourceEvents.at(-1)?.sequence ?? 0;
    const [child] = await transaction.insert(agentSessions).values({
      userId,
      title: `Fork of ${source.title}`.slice(0, 100),
      model: source.model,
      capability: source.capability,
      promptVersion: source.promptVersion,
      systemPrompt: source.systemPrompt,
      workspaceRoot: source.workspaceRoot,
      status: "idle",
      nextEventSequence: boundarySequence + 2,
    }).returning();
    if (sourceEvents.length > 0) {
      await transaction.insert(agentEvents).values(sourceEvents.map((event) => ({
        sessionId: child.id,
        runId: null,
        sequence: event.sequence,
        type: event.type,
        payload: event.payload,
        createdAt: event.createdAt,
      })));
    }
    await transaction.insert(agentEvents).values({
      sessionId: child.id,
      runId: null,
      sequence: boundarySequence + 1,
      type: "session_forked",
      payload: { parentSessionId: sourceSessionId, boundarySequence },
    });
    return child;
  });
}

export async function getAgentSession(userId: string, sessionId: string) {
  await recoverStaleAgentRun(userId, sessionId);
  const [row] = await db
    .select()
    .from(agentSessions)
    .where(and(eq(agentSessions.id, sessionId), eq(agentSessions.userId, userId)))
    .limit(1);
  return row ?? null;
}

export async function renameAgentSession(userId: string, sessionId: string, title: string) {
  await db
    .update(agentSessions)
    .set({ title, updatedAt: new Date() })
    .where(and(eq(agentSessions.id, sessionId), eq(agentSessions.userId, userId)));
}

export async function listAgentEvents(userId: string, sessionId: string, afterSequence = 0) {
  const session = await getAgentSession(userId, sessionId);
  if (!session) return null;
  const condition = and(
    eq(agentEvents.sessionId, sessionId),
    sql`${agentEvents.sequence} > ${afterSequence}`,
  );
  const rows = await db.select().from(agentEvents).where(condition).orderBy(asc(agentEvents.sequence)).limit(1_000);
  return rows as AgentEvent[];
}

export async function listAgentUiEvents(userId: string, sessionId: string, beforeSequence?: number) {
  const session = await getAgentSession(userId, sessionId);
  if (!session) return null;
  const conditions = [
    eq(agentEvents.sessionId, sessionId),
    notInArray(agentEvents.type, ["assistant_chunk", "assistant_delta"]),
  ];
  if (beforeSequence !== undefined) conditions.push(lt(agentEvents.sequence, beforeSequence));
  const rows = await db.select().from(agentEvents)
    .where(and(...conditions))
    .orderBy(desc(agentEvents.sequence))
    .limit(1_000);
  return (rows as AgentEvent[]).reverse();
}

export async function recoverStaleAgentRun(userId: string, sessionId: string) {
  return db.transaction(async (transaction) => {
    const [ownedSession] = await transaction
      .select({ id: agentSessions.id })
      .from(agentSessions)
      .where(and(eq(agentSessions.id, sessionId), eq(agentSessions.userId, userId)))
      .limit(1);
    if (!ownedSession) return false;
    const [staleRun] = await transaction
      .update(agentRuns)
      .set({
        status: "failed",
        errorMessage: "Agent run did not reach a terminal state",
        completedAt: new Date(),
      })
      .where(and(
        eq(agentRuns.sessionId, sessionId),
        eq(agentRuns.status, "running"),
        lt(agentRuns.startedAt, new Date(Date.now() - 5 * 60_000)),
      ))
      .returning({ id: agentRuns.id });
    if (!staleRun) return false;
    const [sequence] = await transaction
      .update(agentSessions)
      .set({
        status: "failed",
        nextEventSequence: sql`${agentSessions.nextEventSequence} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(agentSessions.id, sessionId))
      .returning({ nextEventSequence: agentSessions.nextEventSequence });
    if (!sequence) throw new Error("Agent session disappeared during stale-run recovery");
    await transaction.insert(agentEvents).values({
      sessionId,
      runId: staleRun.id,
      sequence: sequence.nextEventSequence - 1,
      type: "run_failed",
      payload: { message: "A previous agent run was recovered after interruption" },
    });
    return true;
  });
}

export async function appendAgentEvent(input: {
  sessionId: string;
  runId?: string;
  type: AgentEventType;
  payload: Record<string, unknown>;
}) {
  return db.transaction(async (transaction) => {
    const [session] = await transaction
      .update(agentSessions)
      .set({
        nextEventSequence: sql`${agentSessions.nextEventSequence} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(agentSessions.id, input.sessionId))
      .returning({ nextEventSequence: agentSessions.nextEventSequence });
    if (!session) throw new Error("Agent session not found");
    const [event] = await transaction
      .insert(agentEvents)
      .values({
        sessionId: input.sessionId,
        runId: input.runId,
        sequence: session.nextEventSequence - 1,
        type: input.type,
        payload: input.payload,
      })
      .returning();
    return event as AgentEvent;
  });
}

export async function beginAgentRun(input: {
  userId: string;
  sessionId: string;
  maxSteps: number;
}) {
  return db.transaction(async (transaction) => {
    const [ownedSession] = await transaction
      .select({ id: agentSessions.id })
      .from(agentSessions)
      .where(and(eq(agentSessions.id, input.sessionId), eq(agentSessions.userId, input.userId)))
      .limit(1);
    if (!ownedSession) return null;

    const staleBefore = new Date(Date.now() - 5 * 60_000);
    const [staleRun] = await transaction
      .update(agentRuns)
      .set({
        status: "failed",
        errorMessage: "Agent run did not reach a terminal state",
        completedAt: new Date(),
      })
      .where(and(
        eq(agentRuns.sessionId, input.sessionId),
        eq(agentRuns.status, "running"),
        lt(agentRuns.startedAt, staleBefore),
      ))
      .returning({ id: agentRuns.id });
    if (staleRun) {
      const [sequence] = await transaction
        .update(agentSessions)
        .set({
          status: "failed",
          nextEventSequence: sql`${agentSessions.nextEventSequence} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(agentSessions.id, input.sessionId))
        .returning({ nextEventSequence: agentSessions.nextEventSequence });
      if (!sequence) throw new Error("Agent session disappeared during stale-run recovery");
      await transaction.insert(agentEvents).values({
        sessionId: input.sessionId,
        runId: staleRun.id,
        sequence: sequence.nextEventSequence - 1,
        type: "run_failed",
        payload: { message: "A previous agent run was recovered after interruption" },
      });
    }

    const [session] = await transaction
      .update(agentSessions)
      .set({ status: "running", updatedAt: new Date() })
      .where(and(
        eq(agentSessions.id, input.sessionId),
        eq(agentSessions.userId, input.userId),
        ne(agentSessions.status, "running"),
      ))
      .returning();
    if (!session) return null;
    const [run] = await transaction
      .insert(agentRuns)
      .values({ sessionId: input.sessionId, maxSteps: input.maxSteps, status: "queued" })
      .returning();
    const [claimedRun] = await transaction
      .update(agentRuns)
      .set({ status: "running", startedAt: new Date() })
      .where(and(eq(agentRuns.id, run.id), eq(agentRuns.status, "queued")))
      .returning();
    if (!claimedRun) throw new Error("Queued agent run could not be claimed");
    return { session, run: claimedRun };
  });
}

export async function claimQueuedAgentRun(input: { userId: string; runId: string }) {
  return db.transaction(async (transaction) => {
    const [candidate] = await transaction
      .select({ sessionId: agentRuns.sessionId })
      .from(agentRuns)
      .innerJoin(agentSessions, eq(agentRuns.sessionId, agentSessions.id))
      .where(and(
        eq(agentRuns.id, input.runId),
        eq(agentRuns.status, "queued"),
        eq(agentSessions.userId, input.userId),
      ))
      .limit(1);
    if (!candidate) return null;
    const [session] = await transaction
      .update(agentSessions)
      .set({ status: "running", updatedAt: new Date() })
      .where(and(
        eq(agentSessions.id, candidate.sessionId),
        ne(agentSessions.status, "running"),
      ))
      .returning();
    if (!session) return null;
    const [run] = await transaction
      .update(agentRuns)
      .set({ status: "running", startedAt: new Date() })
      .where(and(eq(agentRuns.id, input.runId), eq(agentRuns.status, "queued")))
      .returning();
    if (!run) return null;
    return { session, run };
  });
}

export async function settleAgentRun(input: {
  runId: string;
  sessionId: string;
  status: "completed" | "failed" | "cancelled";
  inputTokens?: number;
  outputTokens?: number;
  errorMessage?: string;
  terminalEvent: {
    type: "run_completed" | "run_failed" | "run_cancelled";
    payload: Record<string, unknown>;
  };
}) {
  return db.transaction(async (transaction) => {
    const [run] = await transaction
      .update(agentRuns)
      .set({
        status: input.status,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        errorMessage: input.errorMessage,
        completedAt: new Date(),
      })
      .where(and(
        eq(agentRuns.id, input.runId),
        eq(agentRuns.sessionId, input.sessionId),
        eq(agentRuns.status, "running"),
      ))
      .returning({ id: agentRuns.id });
    if (!run) throw new Error("Active agent run not found while settling");
    const [session] = await transaction
      .update(agentSessions)
      .set({
        status: input.status === "failed" ? "failed" : "idle",
        nextEventSequence: sql`${agentSessions.nextEventSequence} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(agentSessions.id, input.sessionId))
      .returning({ nextEventSequence: agentSessions.nextEventSequence });
    if (!session) throw new Error("Agent session not found while settling run");
    const [event] = await transaction
      .insert(agentEvents)
      .values({
        sessionId: input.sessionId,
        runId: input.runId,
        sequence: session.nextEventSequence - 1,
        type: input.terminalEvent.type,
        payload: input.terminalEvent.payload,
      })
      .returning();
    return event as AgentEvent;
  });
}

export async function findRunningAgentRun(userId: string, sessionId: string) {
  const [run] = await db
    .select({ id: agentRuns.id })
    .from(agentRuns)
    .innerJoin(agentSessions, eq(agentRuns.sessionId, agentSessions.id))
    .where(and(
      eq(agentRuns.sessionId, sessionId),
      eq(agentSessions.userId, userId),
      eq(agentRuns.status, "running"),
    ))
    .orderBy(desc(agentRuns.startedAt))
    .limit(1);
  return run ?? null;
}

export async function deriveAgentMessages(sessionId: string): Promise<ModelMessage[]> {
  const rows = await db
    .select()
    .from(agentEvents)
    .where(eq(agentEvents.sessionId, sessionId))
    .orderBy(asc(agentEvents.sequence));
  return projectModelInput(rows as AgentEvent[]).messages;
}

export async function loadAgentEvents(sessionId: string) {
  return await db.select().from(agentEvents)
    .where(eq(agentEvents.sessionId, sessionId))
    .orderBy(asc(agentEvents.sequence)) as AgentEvent[];
}

export async function appendAgentEventsAtomically(input: {
  sessionId: string;
  runId?: string;
  events: Array<{ type: AgentEventType; payload: Record<string, unknown> }>;
}) {
  if (input.events.length === 0) return [];
  return db.transaction(async (transaction) => {
    const [session] = await transaction.update(agentSessions).set({
      nextEventSequence: sql`${agentSessions.nextEventSequence} + ${input.events.length}`,
      updatedAt: new Date(),
    }).where(eq(agentSessions.id, input.sessionId))
      .returning({ nextEventSequence: agentSessions.nextEventSequence });
    if (!session) throw new Error("Agent session not found");
    const firstSequence = session.nextEventSequence - input.events.length;
    const rows = await transaction.insert(agentEvents).values(input.events.map((event, index) => ({
      sessionId: input.sessionId,
      runId: input.runId,
      sequence: firstSequence + index,
      type: event.type,
      payload: event.payload,
    }))).returning();
    return (rows as AgentEvent[]).sort((left, right) => left.sequence - right.sequence);
  });
}
