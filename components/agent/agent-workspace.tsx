"use client";

import { useCallback, useDeferredValue, useMemo, useRef, useState } from "react";
import {
  Bot,
  BrainCircuit,
  ChevronRight,
  CircleStop,
  FileSearch,
  Loader2,
  MessageSquarePlus,
  PanelRight,
  Send,
  Sparkles,
  UserRound,
  Wrench,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { AgentEvent, AgentSessionSummary } from "@/lib/agent/types";
import {
  applyAssistantChunk,
  compactAssistantBlocks,
  type AssistantDisplayBlock as AssistantBlock,
} from "@/lib/agent/chunks";

type AgentWorkspaceProps = {
  initialSessions: AgentSessionSummary[];
  initialDetail: SessionDetail | null;
};

type SessionDetail = {
  session: AgentSessionSummary;
  events: AgentEvent[];
};

type ConversationMessage = {
  role: "user" | "assistant";
  blocks: AssistantBlock[];
};

function contentBlocks(content: unknown): AssistantBlock[] {
  if (typeof content === "string") return content ? [{ kind: "text", text: content, active: false }] : [];
  if (!Array.isArray(content)) return [];
  return content.flatMap((part) => {
    if (!part || typeof part !== "object") return [];
    const item = part as { type?: unknown; text?: unknown };
    if ((item.type === "text" || item.type === "reasoning") && typeof item.text === "string") {
      return [{ kind: item.type, text: item.text, active: false } satisfies AssistantBlock];
    }
    return [];
  });
}

function eventMessage(event: AgentEvent): ConversationMessage | null {
  const message = event.payload.message;
  if (!message || typeof message !== "object") return null;
  const record = message as { role?: unknown; content?: unknown };
  if (record.role !== "user" && record.role !== "assistant") return null;
  const blocks = contentBlocks(record.content);
  return blocks.length > 0 ? { role: record.role, blocks } : null;
}

function reasoningSummary(text: string, running: boolean) {
  const visible = running ? text.trimEnd() : text;
  const lines = visible.split("\n");
  return (running ? lines.at(-1) : lines[0])?.trim() || (running ? "Thinking…" : "Reasoning");
}

function ReasoningRow({ text, running }: { text: string; running: boolean }) {
  return (
    <details className="group rounded-lg text-muted-foreground">
      <summary className={cn(
        "flex cursor-pointer list-none items-center gap-2 overflow-hidden rounded-md py-1 text-sm [&::-webkit-details-marker]:hidden",
        running && "animate-pulse",
      )}>
        <BrainCircuit className="size-3.5 shrink-0" />
        <span className="shrink-0">Think</span>
        <span aria-hidden className="size-0.5 shrink-0 rounded-full bg-muted-foreground/50" />
        <span className="min-w-0 flex-1 truncate text-xs">{reasoningSummary(text, running)}</span>
        <ChevronRight className="size-3.5 shrink-0 transition-transform group-open:rotate-90" />
      </summary>
      <div className="ml-[1.35rem] whitespace-pre-wrap border-l pl-3 text-xs leading-5 text-muted-foreground">
        {text}
      </div>
    </details>
  );
}

function AssistantContent({ blocks, running = false }: { blocks: AssistantBlock[]; running?: boolean }) {
  const last = blocks.length - 1;
  return (
    <div className="space-y-2">
      {blocks.map((block, index) => block.kind === "reasoning" ? (
        <ReasoningRow key={`${block.kind}-${index}`} text={block.text} running={running && block.active && index === last} />
      ) : (
        <div key={`${block.kind}-${index}`} className="whitespace-pre-wrap text-sm leading-6">
          {block.text}
          {running && block.active && index === last ? <span className="ml-1 inline-block h-4 w-0.5 animate-pulse bg-foreground align-middle" /> : null}
        </div>
      ))}
    </div>
  );
}

function traceLabel(event: AgentEvent) {
  switch (event.type) {
    case "run_started": return "Run started";
    case "step_started": return "Model step";
    case "tool_called": return `Tool · ${String(event.payload.toolName ?? "unknown")}`;
    case "tool_completed": return `Result · ${String(event.payload.toolName ?? "unknown")}`;
    case "step_completed": return `Step · ${String(event.payload.finishReason ?? "completed")}`;
    case "run_completed": return "Run completed";
    case "run_failed": return "Run failed";
    case "run_cancelled": return "Run cancelled";
    default: return event.type;
  }
}

function traceDetail(event: AgentEvent) {
  if (event.type === "tool_called") return JSON.stringify(event.payload.input ?? {}, null, 2);
  if (event.type === "tool_completed") {
    return JSON.stringify(event.payload.output ?? event.payload.error ?? {}, null, 2);
  }
  if (event.type === "run_failed" || event.type === "run_cancelled") {
    return String(event.payload.message ?? "Unknown error");
  }
  if (event.type === "step_completed") {
    const usage = event.payload.usage as { inputTokens?: number; outputTokens?: number } | undefined;
    return usage ? `${usage.inputTokens ?? "—"} in · ${usage.outputTokens ?? "—"} out` : "";
  }
  return "";
}

function parseSSEBlock(block: string) {
  const data = block
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  return data ? JSON.parse(data) as AgentEvent : null;
}

export function AgentWorkspace({ initialSessions, initialDetail }: AgentWorkspaceProps) {
  const [sessions, setSessions] = useState(initialSessions);
  const [selectedId, setSelectedId] = useState<string | null>(initialSessions[0]?.id ?? null);
  const [detail, setDetail] = useState<SessionDetail | null>(initialDetail);
  const [message, setMessage] = useState("");
  const [loadingSession, setLoadingSession] = useState(false);
  const [creating, setCreating] = useState(false);
  const [running, setRunning] = useState(initialDetail?.session.status === "running");
  const [liveBlocks, setLiveBlocks] = useState<AssistantBlock[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [traceOpen, setTraceOpen] = useState(false);
  const liveBlocksRef = useRef<(AssistantBlock | undefined)[]>([]);
  const animationFrameRef = useRef<number | null>(null);
  const loadRequestRef = useRef(0);
  const deferredEvents = useDeferredValue(detail?.events ?? []);

  const flushLiveBlocks = useCallback(() => {
    if (animationFrameRef.current !== null) return;
    animationFrameRef.current = requestAnimationFrame(() => {
      animationFrameRef.current = null;
      setLiveBlocks(compactAssistantBlocks(liveBlocksRef.current));
    });
  }, []);

  const loadSession = useCallback(async (id: string) => {
    if (running) return;
    const requestId = loadRequestRef.current + 1;
    loadRequestRef.current = requestId;
    setSelectedId(id);
    setLoadingSession(true);
    setError(null);
    try {
      const response = await fetch(`/api/agent/sessions/${id}`);
      const data = await response.json() as SessionDetail & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Failed to load session");
      if (loadRequestRef.current !== requestId) return;
      setDetail(data);
      setRunning(data.session.status === "running");
    } catch (loadError) {
      if (loadRequestRef.current !== requestId) return;
      setError(loadError instanceof Error ? loadError.message : "Failed to load session");
    } finally {
      if (loadRequestRef.current === requestId) setLoadingSession(false);
    }
  }, [running]);

  const refreshSessions = useCallback(async () => {
    const response = await fetch("/api/agent/sessions");
    if (!response.ok) return;
    const updated = await response.json() as AgentSessionSummary[];
    setSessions(updated);
    setDetail((current) => {
      if (!current) return current;
      const refreshedSession = updated.find((session) => session.id === current.session.id);
      return refreshedSession ? { ...current, session: refreshedSession } : current;
    });
  }, []);

  const createSession = useCallback(async () => {
    if (running) return;
    loadRequestRef.current += 1;
    setCreating(true);
    setError(null);
    try {
      const response = await fetch("/api/agent/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const session = await response.json() as AgentSessionSummary & { error?: string };
      if (!response.ok) throw new Error(session.error ?? "Failed to create session");
      setSessions((current) => [session, ...current]);
      setDetail({ session, events: [] });
      setSelectedId(session.id);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create session");
    } finally {
      setCreating(false);
    }
  }, [running]);

  const acceptStreamEvent = useCallback((event: AgentEvent) => {
    if (event.type === "assistant_chunk") {
      liveBlocksRef.current = [...applyAssistantChunk(liveBlocksRef.current, event.payload.chunk)];
      flushLiveBlocks();
      return;
    }
    if (event.type === "assistant_delta") {
      const previous = liveBlocksRef.current[0];
      liveBlocksRef.current[0] = {
        kind: "text",
        text: (previous?.kind === "text" ? previous.text : "") + String(event.payload.text ?? ""),
        active: true,
      };
      flushLiveBlocks();
      return;
    }
    if (event.type === "model_message") {
      const committed = eventMessage(event);
      if (committed?.role === "assistant") {
        liveBlocksRef.current = [];
        setLiveBlocks([]);
      }
    }
    setDetail((current) => current ? { ...current, events: [...current.events, event] } : current);
  }, [flushLiveBlocks]);

  const sendMessage = useCallback(async () => {
    if (!selectedId || !message.trim() || running || loadingSession) return;
    const prompt = message.trim();
    setMessage("");
    setRunning(true);
    setError(null);
    liveBlocksRef.current = [];
    setLiveBlocks([]);
    try {
      const response = await fetch(`/api/agent/sessions/${selectedId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: prompt }),
      });
      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? "Agent run failed to start");
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";
        for (const block of blocks) {
          const event = parseSSEBlock(block);
          if (event) acceptStreamEvent(event);
        }
        if (done) break;
      }
      if (buffer.trim()) {
        const event = parseSSEBlock(buffer);
        if (event) acceptStreamEvent(event);
      }
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Agent run failed");
    } finally {
      setRunning(false);
      await refreshSessions();
    }
  }, [acceptStreamEvent, loadingSession, message, refreshSessions, running, selectedId]);

  const cancelRun = useCallback(async () => {
    if (!selectedId) return;
    const response = await fetch(`/api/agent/sessions/${selectedId}/cancel`, { method: "POST" });
    if (!response.ok) {
      const data = await response.json().catch(() => ({})) as { error?: string };
      setError(data.error ?? "Unable to cancel this run");
    }
  }, [selectedId]);

  const messages = useMemo(() => deferredEvents
    .filter((event) => event.type === "model_message")
    .flatMap((event) => {
      const parsed = eventMessage(event);
      return parsed ? [{ ...parsed, sequence: event.sequence }] : [];
    }), [deferredEvents]);

  const traceEvents = useMemo(() => deferredEvents.filter((event) =>
    event.type !== "assistant_chunk" && event.type !== "assistant_delta" && event.type !== "model_message",
  ), [deferredEvents]);

  return (
    <main className="h-dvh min-h-[640px] bg-background p-2.5 text-foreground md:p-4">
      <div className="mx-auto grid h-full max-w-[1800px] overflow-hidden rounded-xl border bg-card shadow-sm lg:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[260px_minmax(0,1fr)_340px]">
        <aside className="hidden min-h-0 border-r bg-muted/25 lg:flex lg:flex-col">
          <div className="flex h-16 items-center gap-2.5 border-b px-4">
            <div className="grid size-9 place-items-center rounded-lg bg-foreground text-background">
              <BrainCircuit className="size-5" />
            </div>
            <div>
              <p className="text-sm font-semibold tracking-tight">Seconda Agent</p>
              <p className="text-[11px] text-muted-foreground">Event-sourced harness</p>
            </div>
          </div>
          <div className="p-3">
            <Button className="w-full justify-start" onClick={createSession} disabled={creating || running}>
              {creating ? <Loader2 className="animate-spin" /> : <MessageSquarePlus />}
              New task
            </Button>
          </div>
          <ScrollArea className="min-h-0 flex-1 px-2 pb-3">
            <div className="space-y-1">
              {sessions.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  disabled={running}
                  onClick={() => void loadSession(session.id)}
                  className={cn(
                    "w-full rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60",
                    selectedId === session.id && "bg-accent",
                  )}
                >
                  <span className="block truncate text-sm font-medium">{session.title}</span>
                  <span className="mt-1 flex items-center gap-1.5 text-xs text-foreground">
                    <span className={cn("size-1.5 rounded-full bg-slate-400", session.status === "running" && "bg-emerald-500 animate-pulse", session.status === "failed" && "bg-red-500")} />
                    {session.status}
                  </span>
                </button>
              ))}
            </div>
          </ScrollArea>
        </aside>

        <section className="flex min-h-0 min-w-0 flex-col">
          <header className="flex h-16 shrink-0 items-center justify-between border-b px-4 md:px-6">
            <div className="min-w-0">
              <select
                aria-label="Select agent task"
                value={selectedId ?? ""}
                onChange={(event) => void loadSession(event.target.value)}
                disabled={running || sessions.length === 0}
                className="max-w-52 truncate rounded-md border bg-background px-2 py-1 text-sm font-medium lg:hidden"
              >
                {sessions.length === 0 ? <option value="">Agent workspace</option> : null}
                {sessions.map((session) => <option key={session.id} value={session.id}>{session.title}</option>)}
              </select>
              <h1 className="hidden truncate text-sm font-semibold lg:block">{detail?.session.title ?? "Agent workspace"}</h1>
              <p className="truncate text-xs text-muted-foreground">{detail?.session.model ?? "Create a task to begin"}</p>
            </div>
            <div className="flex items-center gap-2">
              {running ? <Badge variant="secondary" className="gap-1.5"><span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />Running</Badge> : null}
              <Button variant="outline" size="icon" className="xl:hidden" onClick={() => setTraceOpen((value) => !value)} aria-label="Toggle run trace">
                <PanelRight />
              </Button>
              <Button className="lg:hidden" size="sm" onClick={createSession} disabled={creating || running}>
                <MessageSquarePlus /> New
              </Button>
            </div>
          </header>

          <ScrollArea className="min-h-0 flex-1">
            <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-4 py-8 md:px-8">
              {loadingSession ? (
                <div className="grid flex-1 place-items-center text-sm text-muted-foreground"><Loader2 className="mr-2 inline size-4 animate-spin" />Loading task</div>
              ) : !detail ? (
                <div className="grid flex-1 place-items-center py-20 text-center">
                  <div className="max-w-md">
                    <div className="mx-auto mb-5 grid size-14 place-items-center rounded-xl border bg-muted/50"><Sparkles className="size-6" /></div>
                    <h2 className="text-xl font-semibold tracking-tight">A harness you can inspect</h2>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">Every model step, tool call and committed message is recorded as an ordered event.</p>
                    <Button className="mt-6" onClick={createSession} disabled={creating || running}>Create your first task</Button>
                  </div>
                </div>
              ) : messages.length === 0 && !running ? (
                <div className="grid flex-1 place-items-center py-20 text-center">
                  <div className="max-w-lg">
                    <FileSearch className="mx-auto mb-5 size-9 text-muted-foreground" />
                    <h2 className="text-xl font-semibold tracking-tight">What should I investigate?</h2>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">Ask about this repository. The agent can list, search and read workspace files while you watch its execution trace.</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-7">
                  {messages.map((item) => (
                    <article key={item.sequence} className={cn("flex gap-3", item.role === "user" && "justify-end")}>
                      {item.role === "assistant" ? <div className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-foreground text-background"><Bot className="size-4" /></div> : null}
                      <div className={cn("max-w-[85%]", item.role === "user" ? "rounded-xl bg-muted px-4 py-2.5" : "min-w-0 pt-1")}><AssistantContent blocks={item.blocks} /></div>
                      {item.role === "user" ? <div className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border"><UserRound className="size-4" /></div> : null}
                    </article>
                  ))}
                  {liveBlocks.length > 0 ? (
                    <article className="flex gap-3">
                      <div className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-foreground text-background"><Bot className="size-4" /></div>
                      <div className="min-w-0 max-w-[85%] pt-1"><AssistantContent blocks={liveBlocks} running /></div>
                    </article>
                  ) : running ? (
                    <div className="flex items-center gap-3 text-sm text-muted-foreground"><div className="grid size-8 place-items-center rounded-lg bg-foreground text-background"><Bot className="size-4" /></div><Loader2 className="size-4 animate-spin" />Thinking and inspecting…</div>
                  ) : null}
                </div>
              )}
            </div>
          </ScrollArea>

          <div className="shrink-0 border-t bg-card/95 p-3 backdrop-blur md:p-4">
            <div className="mx-auto max-w-3xl">
              {error ? <p role="status" aria-live="polite" className="mb-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p> : null}
              <div className="flex items-end gap-2 rounded-xl border bg-background p-2 shadow-sm focus-within:ring-2 focus-within:ring-ring/30">
                <Textarea
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void sendMessage();
                    }
                  }}
                  disabled={!detail || running || loadingSession}
                  aria-label="Message the agent"
                  placeholder={detail ? "Ask the agent to inspect this workspace…" : "Create a task first"}
                  className="min-h-11 max-h-40 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
                />
                {running ? (
                  <Button size="icon" variant="destructive" onClick={cancelRun} aria-label="Stop agent"><CircleStop /></Button>
                ) : (
                  <Button size="icon" onClick={sendMessage} disabled={!detail || !message.trim() || loadingSession} aria-label="Send message"><Send /></Button>
                )}
              </div>
              <p className="mt-2 text-center text-[11px] text-muted-foreground">Read-only tools · {DEFAULT_TOOL_COPY}</p>
            </div>
          </div>
        </section>

        <aside
          role={traceOpen ? "dialog" : undefined}
          aria-modal={traceOpen ? true : undefined}
          aria-label="Agent run trace"
          tabIndex={traceOpen ? -1 : undefined}
          onKeyDown={(event) => {
            if (event.key === "Escape") setTraceOpen(false);
          }}
          className={cn("min-h-0 border-l bg-muted/20 xl:flex xl:flex-col", traceOpen ? "fixed inset-y-2.5 right-2.5 z-30 flex w-[min(360px,calc(100vw-20px))] flex-col rounded-xl border bg-card shadow-xl" : "hidden")}
        >
          <div className="flex h-16 shrink-0 items-center justify-between border-b px-4">
            <div><p className="text-sm font-semibold">Run trace</p><p className="text-[11px] text-muted-foreground">Durable lifecycle events</p></div>
            <Button variant="ghost" size="sm" className="xl:hidden" onClick={() => setTraceOpen(false)}>Close</Button>
          </div>
          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-1 p-3">
              {traceEvents.length === 0 ? <p className="px-2 py-8 text-center text-xs text-muted-foreground">The next run will appear here.</p> : traceEvents.map((event) => {
                const detailText = traceDetail(event);
                const isTool = event.type === "tool_called" || event.type === "tool_completed";
                return (
                  <div key={event.sequence} className="rounded-lg border bg-card p-3">
                    <div className="flex items-center gap-2 text-xs font-medium">
                      {isTool ? <Wrench className="size-3.5" /> : <BrainCircuit className="size-3.5" />}
                      <span className="min-w-0 flex-1 truncate">{traceLabel(event)}</span>
                      <span className="font-mono text-[10px] text-muted-foreground">#{event.sequence}</span>
                    </div>
                    {detailText ? <pre tabIndex={0} className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted/60 p-2 font-mono text-[10px] leading-4 text-muted-foreground">{detailText}</pre> : null}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </aside>
      </div>
    </main>
  );
}

const DEFAULT_TOOL_COPY = "list · search · read";
