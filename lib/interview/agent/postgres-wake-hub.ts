import postgres from "postgres";
import { z } from "zod";

const agentEventWakeSchema = z.object({
  runId: z.string().min(1),
  latestSequence: z.number().int().positive(),
}).strict();

export type AgentEventWake = z.infer<typeof agentEventWakeSchema>;
export type AgentEventWakeResult = "notified" | "timeout";

export interface AgentEventWakeHub {
  waitForRun(
    runId: string,
    afterSequence: number,
    signal: AbortSignal,
    timeoutMs: number,
  ): Promise<AgentEventWakeResult>;
}

type Waiter = {
  afterSequence: number;
  settle: (result: AgentEventWakeResult) => void;
};

export function createInMemoryAgentEventWakeHub(): AgentEventWakeHub & {
  publish(wake: AgentEventWake): void;
} {
  const latestSequences = new Map<string, number>();
  const waiters = new Map<string, Set<Waiter>>();

  return {
    publish(wake) {
      const latestSequence = Math.max(
        latestSequences.get(wake.runId) ?? 0,
        wake.latestSequence,
      );
      latestSequences.set(wake.runId, latestSequence);
      for (const waiter of waiters.get(wake.runId) ?? []) {
        if (latestSequence > waiter.afterSequence) waiter.settle("notified");
      }
    },
    async waitForRun(runId, afterSequence, signal, timeoutMs) {
      if ((latestSequences.get(runId) ?? 0) > afterSequence) return "notified";
      if (signal.aborted) throw abortReason(signal);

      return new Promise<AgentEventWakeResult>((resolve, reject) => {
        const runWaiters = waiters.get(runId) ?? new Set<Waiter>();
        let settled = false;
        const waiter: Waiter = {
          afterSequence,
          settle(result) {
            finish(() => resolve(result));
          },
        };
        const onAbort = () => finish(() => reject(abortReason(signal)));
        const finish = (complete: () => void) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          signal.removeEventListener("abort", onAbort);
          runWaiters.delete(waiter);
          if (runWaiters.size === 0) waiters.delete(runId);
          complete();
        };

        runWaiters.add(waiter);
        waiters.set(runId, runWaiters);
        const timeout = setTimeout(
          () => finish(() => resolve("timeout")),
          Math.max(0, timeoutMs),
        );
        signal.addEventListener("abort", onAbort, { once: true });
      });
    },
  };
}

export function parseAgentEventWake(payload: string): AgentEventWake | null {
  try {
    const parsed = agentEventWakeSchema.safeParse(JSON.parse(payload));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

class PostgresAgentEventWakeHub implements AgentEventWakeHub {
  private readonly core = createInMemoryAgentEventWakeHub();
  private client: ReturnType<typeof postgres> | null = null;
  private unlisten: (() => Promise<void>) | null = null;
  private starting: Promise<void> | null = null;
  private closePromise: Promise<void> | null = null;
  private retryAfter = 0;
  private closed = false;

  waitForRun(
    runId: string,
    afterSequence: number,
    signal: AbortSignal,
    timeoutMs: number,
  ) {
    this.ensureListening();
    return this.core.waitForRun(runId, afterSequence, signal, timeoutMs);
  }

  close() {
    this.closePromise ??= this.closeOnce();
    return this.closePromise;
  }

  private async closeOnce() {
    this.closed = true;
    const starting = this.starting;
    const unlisten = this.unlisten;
    const client = this.client;
    this.starting = null;
    this.unlisten = null;
    this.client = null;
    if (unlisten) {
      try {
        await unlisten();
      } catch {
        // The connection may already be gone during process shutdown.
      }
    }
    if (client) {
      try {
        await client.end({ timeout: 1 });
      } catch {
        // Shutdown is best-effort and must not surface as an unhandled rejection.
      }
    }
    if (starting) {
      try {
        await starting;
      } catch {
        // Listener startup failure is already covered by the polling fallback.
      }
    }
  }

  private ensureListening() {
    const databaseUrl = process.env.DATABASE_URL;
    if (
      this.closed
      || !databaseUrl
      || this.unlisten
      || this.starting
      || Date.now() < this.retryAfter
    ) return;

    const starting = this.startListening(databaseUrl);
    this.starting = starting;
    const clearStarting = () => {
      if (this.starting === starting) this.starting = null;
    };
    void starting.then(clearStarting, clearStarting);
  }

  private async startListening(databaseUrl: string) {
    let client: ReturnType<typeof postgres> | null = null;
    try {
      client = postgres(databaseUrl, { prepare: false, max: 1 });
      this.client = client;
      const subscription = await client.listen("interview_agent_events", (payload) => {
        const wake = parseAgentEventWake(payload);
        if (wake) this.core.publish(wake);
      });
      if (this.closed) {
        try {
          await subscription.unlisten();
        } catch {
          // The listener can close while shutdown is already in progress.
        }
        try {
          await client.end({ timeout: 1 });
        } catch {
          // The connection may already have been ended by close().
        }
        if (this.client === client) this.client = null;
        return;
      }
      this.unlisten = () => subscription.unlisten();
      this.retryAfter = 0;
    } catch {
      if (client && this.client === client) this.client = null;
      this.retryAfter = Date.now() + 5_000;
      if (client) {
        try {
          await client.end({ timeout: 1 });
        } catch {
          // A later SSE wait retries after the short backoff.
        }
      }
    }
  }
}

type AgentEventWakeGlobal = typeof globalThis & {
  __secondaAgentEventWakeHub?: PostgresAgentEventWakeHub;
  __secondaAgentEventWakeHubCleanupRegistered?: boolean;
};

export function getPostgresAgentEventWakeHub(): AgentEventWakeHub {
  const processGlobal = globalThis as AgentEventWakeGlobal;
  const hub = processGlobal.__secondaAgentEventWakeHub
    ?? new PostgresAgentEventWakeHub();
  processGlobal.__secondaAgentEventWakeHub = hub;
  if (!processGlobal.__secondaAgentEventWakeHubCleanupRegistered) {
    processGlobal.__secondaAgentEventWakeHubCleanupRegistered = true;
    const cleanup = () => {
      void hub.close().catch(() => undefined);
    };
    process.once("beforeExit", cleanup);
    registerShutdownSignal(hub, "SIGINT", 130);
    registerShutdownSignal(hub, "SIGTERM", 143);
  }
  return hub;
}

function registerShutdownSignal(
  hub: PostgresAgentEventWakeHub,
  signal: NodeJS.Signals,
  exitCode: number,
) {
  process.once(signal, () => {
    void hub.close().then(
      () => process.exit(exitCode),
      () => process.exit(exitCode),
    );
  });
}

function abortReason(signal: AbortSignal) {
  return signal.reason ?? new DOMException("The operation was aborted", "AbortError");
}
