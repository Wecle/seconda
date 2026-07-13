"use client";

import { useCallback, useReducer, useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, FileText, Loader2, LogOut, Send } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { InterviewResumeContextSheet } from "./interview-resume-context-sheet";
import { AgentThinkingPanel } from "./agent-thinking-panel";
import { AgentArtifactCard } from "./agent-artifact-card";
import { InterviewCompletionProgress, type ScoringProgress } from "./interview-completion-progress";
import { useCompletionPolling } from "./use-completion-polling";
import { agentRoomReducer, initialAgentRoomState, type PublicRoomEvent } from "@/lib/interview/agent/room-state";
import type { CommittedArtifact, PublicThinkingEntry } from "@/lib/interview/agent/contracts";
import type { ParsedResume } from "@/lib/resume/types";
import {
  useAgentRunStream,
  type AgentRunStreamEvent,
  type AgentRunStreamStatus,
} from "./use-agent-run-stream";

type AgentMessage = { id: string; runId?: string | null; sequence: number; role: string; kind: string; content: string };
type AgentRun = AgentRunStreamStatus;
type ResumeSnapshot = { id: string; versionNumber: number; originalFilename: string; originalFileUrl: string | null; parseStatus: string; parsedData: ParsedResume | null };

export function AgentInterviewRoom({ interviewId, initialMessages, initialRun, resumeSnapshot, status, initialScoringProgress, initialArtifacts = [], initialEvents = [] }: {
  interviewId: string;
  initialMessages: AgentMessage[];
  initialRun: AgentRun | null;
  resumeSnapshot: ResumeSnapshot | null;
  status: string;
  initialScoringProgress?: ScoringProgress | null;
  initialArtifacts?: CommittedArtifact[];
  initialEvents?: PublicRoomEvent[];
}) {
  const router = useRouter();
  const [room, dispatch] = useReducer(agentRoomReducer, { messages: initialMessages, artifacts: initialArtifacts, events: initialEvents }, (value) => initialAgentRoomState(value.messages, value.artifacts, value.events));
  const [run, setRun] = useState(initialRun);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(initialRun?.status === "running");
  const [ending, setEnding] = useState(false);
  const [resumeOpen, setResumeOpen] = useState(false);
  const [interviewStatus, setInterviewStatus] = useState(status);
  const [scoringProgress, setScoringProgress] = useState<ScoringProgress | null>(initialScoringProgress ?? null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(`/api/interviews/${interviewId}`, { cache: "no-store", signal });
    if (!response.ok) throw new Error("面试状态加载失败");
    const data = await response.json();
    dispatch({ type: "messages_refreshed", messages: data.agentState?.messages ?? [] });
    setInterviewStatus(data.interview.status);
    setScoringProgress(data.agentState?.scoringProgress ?? null);
    const latest = data.agentState?.latestRun ?? null;
    setRun(latest);
    return latest as AgentRun | null;
  }, [interviewId]);

  const completionPolling = useCompletionPolling({
    active: ["completing", "scoring", "reporting"].includes(interviewStatus),
    status: interviewStatus,
    refresh: (signal) => refresh(signal).then(() => undefined),
  });

  const retryCompletion = async () => {
    const response = await fetch(`/api/interviews/${interviewId}/completion/resume`, { method: "POST" });
    if (response.ok) await refresh();
  };

  const handleRunEvent = useCallback(async (event: AgentRunStreamEvent) => {
    if (event.type === "thinking_started") {
      if (run?.id) dispatch({ type: "run_accepted", runId: run.id });
      return;
    }
    if (event.type === "text_delta") {
      const payload = event.payload as { runId?: unknown; messageId?: unknown; text?: unknown };
      if (typeof payload.runId === "string" && typeof payload.messageId === "string" && typeof payload.text === "string") {
        dispatch({ type: "provisional_delta", runId: payload.runId, messageId: payload.messageId, text: payload.text });
      }
      return;
    }
    if (event.type === "response_started") {
      const payload = event.payload as { runId?: unknown; messageId?: unknown };
      if (typeof payload.runId === "string" && typeof payload.messageId === "string") {
        dispatch({ type: "response_started", runId: payload.runId, messageId: payload.messageId });
      }
      return;
    }
    if (event.type === "thinking_summary") {
      dispatch({ type: "thinking_summary", entry: event.payload as PublicThinkingEntry });
      return;
    }
    if (event.type === "artifact_committed") {
      dispatch({ type: "artifact_committed", artifact: event.payload as CommittedArtifact });
      return;
    }
    if (event.type === "message_committed") {
      const payload = event.payload as { runId?: unknown };
      if (typeof payload.runId === "string") dispatch({ type: "message_committed", runId: payload.runId });
      await refresh();
      return;
    }
    if (event.type === "run_completed" || event.type === "run_failed") {
      setBusy(false);
      if (event.type === "run_failed") {
        if (run?.id) dispatch({ type: "run_failed", runId: run.id });
        const payload = event.payload as { userMessage?: unknown };
        setError(typeof payload?.userMessage === "string"
          ? payload.userMessage
          : "本轮生成未完成，请重新提交或稍后重试。");
      }
      await refresh();
    }
  }, [refresh, run]);

  const handleTerminalRun = useCallback(async (terminal: AgentRunStreamStatus) => {
    setBusy(false);
    if (terminal.status === "failed") {
      dispatch({ type: "run_failed", runId: terminal.id });
      setError(terminal.userMessage ?? "本轮生成未完成，请重新提交或稍后重试。");
    }
    await refresh();
  }, [refresh]);

  const { connectionState, retry: retryConnection } = useAgentRunStream({
    interviewId,
    run,
    onEvent: handleRunEvent,
    onTerminal: handleTerminalRun,
  });

  const submit = async () => {
    const content = draft.trim();
    if (!content || busy) return;
    const localId = crypto.randomUUID();
    const idempotencyKey = crypto.randomUUID();
    dispatch({ type: "candidate_submitted", localId, content });
    setDraft("");
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/interviews/${interviewId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, idempotencyKey }),
    });
    if (!response.ok) {
      setBusy(false);
      dispatch({ type: "candidate_failed", localId });
      setError("回答提交失败，请重试。");
      return;
    }
    const data = await response.json() as { runId: string; message: { id: string; sequence: number; content: string } };
    dispatch({ type: "candidate_committed", localId, runId: data.runId, message: data.message });
    dispatch({ type: "run_accepted", runId: data.runId });
    setRun({ id: data.runId, status: "running", exitReason: null, userMessage: null, lastEventSequence: 0 });
  };

  const end = async () => {
    if (ending) return;
    setEnding(true);
    const response = await fetch(`/api/interviews/${interviewId}/end`, { method: "POST" });
    if (response.ok) await refresh();
    else setError("结束面试失败，请重试。");
    setEnding(false);
  };

  const completed = ["completing", "scoring", "reporting", "completed", "failed"].includes(interviewStatus);
  const userRunIds = new Set(room.messages.filter((message) => message.role === "user" && message.runId).map((message) => message.runId));
  const renderTurn = (runId: string) => {
    const turn = room.turns[runId];
    if (!turn) return null;
    return <div className="space-y-4" key={`turn:${runId}`}>
      <AgentThinkingPanel thinking={turn.thinking} active={busy && run?.id === runId && !turn.responseStarted} onToggle={(expanded) => dispatch({ type: "thinking_toggled", runId, expanded })} />
      {turn.artifacts.map((artifact) => <AgentArtifactCard key={artifact.artifactId} artifact={artifact} />)}
      {turn.provisional && <div className="max-w-[86%] rounded-2xl rounded-bl-md border bg-card px-5 py-4 opacity-80"><ReactMarkdown remarkPlugins={[remarkGfm]}>{turn.provisional}</ReactMarkdown></div>}
    </div>;
  };
  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="flex h-16 items-center justify-between border-b px-6">
        <div className="flex items-center gap-3"><div className="flex size-9 items-center justify-center rounded-full bg-primary/10"><Bot className="size-5 text-primary" /></div><div><p className="font-semibold">AI 面试官</p><p className="text-xs text-muted-foreground">根据你的简历与回答动态追问 · 最多 20 轮</p></div></div>
        <div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => setResumeOpen(true)}><FileText className="size-4" />简历上下文</Button>{!completed && <Button variant="ghost" size="sm" onClick={end} disabled={ending}><LogOut className="size-4" />结束面试</Button>}</div>
      </header>

      <main className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col">
        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-8">
          {room.messages.map((message) => <div className="contents" key={message.id}>
            {message.role === "assistant" && message.runId && !userRunIds.has(message.runId) ? renderTurn(message.runId) : null}
            <div className={message.role === "user" ? "ml-auto max-w-[80%]" : "max-w-[86%]"}><div className={`${message.role === "user" ? "rounded-2xl rounded-br-md bg-primary px-4 py-3 text-primary-foreground" : "rounded-2xl rounded-bl-md border bg-card px-5 py-4 shadow-sm"} ${message.status === "failed" ? "opacity-60 ring-1 ring-destructive" : ""}`}><ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown></div></div>
            {message.role === "user" && message.runId ? renderTurn(message.runId) : null}
          </div>)}
          {busy && run?.id && !room.messages.some((message) => message.runId === run.id) ? renderTurn(run.id) : null}
          {busy && !run?.id && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />面试官正在思考下一步...</div>}
          {connectionState === "reconnecting" && <p className="text-sm text-amber-600">连接正在恢复，已接收的正式消息不会丢失。</p>}
          {connectionState === "manual_retry" && <Button variant="outline" size="sm" onClick={retryConnection}>重新连接</Button>}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <div className="border-t bg-background p-5">
          {completed ? <div className="space-y-3"><InterviewCompletionProgress status={interviewStatus} progress={scoringProgress} onRetry={() => void retryCompletion()} />{completionPolling.timedOut && <div className="grid grid-cols-2 gap-2"><Button variant="outline" onClick={() => void completionPolling.refreshNow()}>手动刷新状态</Button><Button variant="outline" onClick={completionPolling.resumePolling}>继续自动检查</Button></div>}{interviewStatus === "completed" && <Button className="w-full" onClick={() => router.push(`/interviews/${interviewId}/report`)}>查看报告</Button>}</div> : <div className="relative"><Textarea value={draft} onChange={(event) => setDraft(event.target.value)} disabled={busy} rows={4} placeholder="输入你的回答。你也可以说明希望结束面试。" className="resize-none pr-14" onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void submit(); }} /><Button size="icon" className="absolute bottom-3 right-3" onClick={submit} disabled={busy || !draft.trim()}><Send className="size-4" /></Button><p className="mt-2 text-xs text-muted-foreground">⌘ / Ctrl + Enter 提交</p></div>}
        </div>
      </main>
      <InterviewResumeContextSheet open={resumeOpen} onOpenChange={setResumeOpen} snapshot={resumeSnapshot} currentQuestion={room.messages.filter((message) => message.role === "assistant").at(-1)?.content ?? ""} />
    </div>
  );
}
