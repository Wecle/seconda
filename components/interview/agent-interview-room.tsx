"use client";

import { memo, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, FileText, Loader2, LogOut, Send } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { InterviewResumeContextSheet } from "./interview-resume-context-sheet";
import { AgentLiveTurn } from "./agent-live-turn";
import { InterviewCompletionProgress, type ScoringProgress } from "./interview-completion-progress";
import { buildInterviewRoomTimeline, type InterviewRoomTimelineGroup } from "./interview-room-timeline";
import { useCompletionPolling } from "./use-completion-polling";
import { agentRoomReducer, initialAgentRoomState, type PublicRoomEvent, type RoomMessage, type RoomTurn } from "@/lib/interview/agent/room-state";
import { latestRunSnapshotSequence } from "@/lib/interview/agent/client-stream";
import type { CommittedArtifact } from "@/lib/interview/agent/contracts";
import type { ParsedResume } from "@/lib/resume/types";
import { clearPendingAnswer, loadPendingAnswer, savePendingAnswer, type PendingAnswer } from "@/lib/interview/agent/pending-answer";
import {
  useAgentRunStream,
  type AgentRunStreamEvent,
  type AgentRunStreamStatus,
} from "./use-agent-run-stream";

type AgentMessage = { id: string; runId?: string | null; sequence: number; role: string; kind: string; content: string };
type AgentRun = AgentRunStreamStatus;
type ResumeSnapshot = { id: string; versionNumber: number; originalFilename: string; originalFileUrl: string | null; parseStatus: string; parsedData: ParsedResume | null };

const markdownPlugins = [remarkGfm];
const noInitialArtifacts: CommittedArtifact[] = [];
const noInitialEvents: PublicRoomEvent[] = [];

const InterviewTranscript = memo(function InterviewTranscript({ timeline, turns, activeRunId, busy, onToggleThinking }: {
  timeline: readonly InterviewRoomTimelineGroup[];
  turns: Readonly<Record<string, RoomTurn>>;
  activeRunId: string | null;
  busy: boolean;
  onToggleThinking: (runId: string, expanded: boolean) => void;
}) {
  return timeline.map((group) => <TimelineGroup
    key={group.key}
    group={group}
    turn={group.runId ? turns[group.runId] : undefined}
    active={Boolean(group.runId && busy && activeRunId === group.runId)}
    onToggleThinking={onToggleThinking}
  />);
});

const TimelineGroup = memo(function TimelineGroup({ group, turn, active, onToggleThinking }: {
  group: InterviewRoomTimelineGroup;
  turn?: RoomTurn;
  active: boolean;
  onToggleThinking: (runId: string, expanded: boolean) => void;
}) {
  return <div className="space-y-3">
    {group.beforeTurn.map((message) => <TranscriptMessage key={message.id} message={message} />)}
    {group.runId && turn ? <LiveTurnSlot
      runId={group.runId}
      turn={turn}
      active={active}
      onToggleThinking={onToggleThinking}
    /> : null}
    {group.afterTurn.map((message) => <TranscriptMessage key={message.id} message={message} />)}
  </div>;
});

const LiveTurnSlot = memo(function LiveTurnSlot({ runId, turn, active, onToggleThinking }: {
  runId: string;
  turn: RoomTurn;
  active: boolean;
  onToggleThinking: (runId: string, expanded: boolean) => void;
}) {
  const onToggle = useCallback((expanded: boolean) => {
    onToggleThinking(runId, expanded);
  }, [onToggleThinking, runId]);

  return <AgentLiveTurn turn={turn} artifacts={turn.artifacts} active={active} onToggle={onToggle} />;
});

const TranscriptMessage = memo(function TranscriptMessage({ message }: { message: RoomMessage }) {
  return <div className={message.role === "user" ? "ml-auto max-w-[80%]" : "max-w-[86%]"}>
    <div className={`${message.role === "user" ? "rounded-2xl rounded-br-md bg-primary px-4 py-3 text-primary-foreground" : "rounded-2xl rounded-bl-md border bg-card px-5 py-4 shadow-sm"} ${message.status === "failed" ? "opacity-60 ring-1 ring-destructive" : ""}`}>
      <ReactMarkdown remarkPlugins={markdownPlugins}>{message.content}</ReactMarkdown>
    </div>
  </div>;
});

export function AgentInterviewRoom({ interviewId, initialMessages, initialRun, resumeSnapshot, status, initialScoringProgress, initialArtifacts = noInitialArtifacts, initialEvents = noInitialEvents }: {
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
  const [submitting, setSubmitting] = useState(false);
  const [pendingAnswer, setPendingAnswer] = useState<PendingAnswer | null>(null);
  const [submissionFailed, setSubmissionFailed] = useState(false);
  const submissionInFlightRef = useRef(false);
  const [ending, setEnding] = useState(false);
  const endingRef = useRef(false);
  const [recoveringRun, setRecoveringRun] = useState(false);
  const runRecoveryInFlightRef = useRef(false);
  const [resumeOpen, setResumeOpen] = useState(false);
  const [interviewStatus, setInterviewStatus] = useState(status);
  const [completionRecoveryRequested, setCompletionRecoveryRequested] = useState(false);
  const [scoringProgress, setScoringProgress] = useState<ScoringProgress | null>(initialScoringProgress ?? null);
  const [error, setError] = useState<string | null>(null);
  const [retryingCompletion, setRetryingCompletion] = useState(false);
  const completionRetryInFlightRef = useRef(false);
  const runRecoveryExhausted = run?.recoveryDisposition === "exhausted";
  const busy = submitting || (run?.status === "running" && !runRecoveryExhausted);
  const runId = run?.id;
  const hydratedRunSequence = useMemo(
    () => latestRunSnapshotSequence(initialEvents, runId),
    [initialEvents, runId],
  );

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(`/api/interviews/${interviewId}`, { cache: "no-store", signal });
    if (!response.ok) throw new Error("面试状态加载失败");
    const data = await response.json();
    dispatch({ type: "messages_refreshed", messages: data.agentState?.messages ?? [] });
    setInterviewStatus(data.interview.status);
    if (data.interview.status !== "failed") setCompletionRecoveryRequested(false);
    setScoringProgress(data.agentState?.scoringProgress ?? null);
    const latest = data.agentState?.latestRun ?? null;
    setRun(latest);
    return latest as AgentRun | null;
  }, [interviewId]);

  const completionPolling = useCompletionPolling({
    active: completionRecoveryRequested || ["completing", "scoring", "reporting"].includes(interviewStatus),
    status: completionRecoveryRequested && interviewStatus === "failed" ? "recovering" : interviewStatus,
    refresh: (signal) => refresh(signal).then(() => undefined),
    resume: async (signal) => {
      const response = await fetch(`/api/interviews/${interviewId}/completion/resume`, { method: "POST", signal });
      if (!response.ok) throw new Error("完成任务恢复失败");
      const result = await response.json() as { status?: string };
      if (result.status === "cooldown") throw new Error("评分恢复正在冷却，请稍后重试。");
      if (result.status === "exhausted") throw new Error("评分恢复次数已用尽，请联系支持人员处理。");
    },
  });

  const resumeRunRequest = useCallback(async (runId: string, signal: AbortSignal) => {
    const response = await fetch(`/api/interviews/${interviewId}/runs/${runId}/resume`, { method: "POST", signal });
    if (!response.ok) throw new Error("Agent Run 恢复失败");
    const result = await response.json() as { status?: string };
    if (result.status === "cooldown") throw new Error("Agent Run 正在冷却，请稍后重试。");
    if (result.status === "exhausted") throw new Error("Agent Run 恢复次数已用尽，答案仍已安全保存。");
  }, [interviewId]);

  const handleRunEvent = useCallback(async (event: AgentRunStreamEvent) => {
    const { sequence } = event;
    switch (event.type) {
      case "run_started":
        dispatch({ type: "run_started", sequence, runId: event.payload.runId, logicalMessageId: event.payload.logicalMessageId });
        return;
      case "phase_changed":
        dispatch({ type: "phase_changed", sequence, runId: event.payload.runId, attemptId: event.payload.attemptId, phase: event.payload.phase });
        return;
      case "attempt_started":
        dispatch({ type: "attempt_started", sequence, runId: event.payload.runId, attemptId: event.payload.attemptId, logicalMessageId: event.payload.logicalMessageId });
        return;
      case "attempt_discarded":
        dispatch({ type: "attempt_discarded", sequence, runId: event.payload.runId, attemptId: event.payload.attemptId, logicalMessageId: event.payload.logicalMessageId, reason: event.payload.reason });
        return;
      case "reasoning_started":
        dispatch({ type: "reasoning_started", sequence, runId: event.payload.runId, attemptId: event.payload.attemptId, entryId: event.payload.entryId });
        return;
      case "reasoning_delta":
        dispatch({ type: "reasoning_delta", sequence, runId: event.payload.runId, attemptId: event.payload.attemptId, entryId: event.payload.entryId, text: event.payload.text });
        return;
      case "reasoning_completed":
        dispatch({ type: "reasoning_completed", sequence, runId: event.payload.runId, attemptId: event.payload.attemptId, entryId: event.payload.entryId });
        return;
      case "tool_call_started":
      case "tool_call_completed":
        dispatch({ type: event.type, sequence, runId: event.payload.runId, attemptId: event.payload.attemptId, toolCallId: event.payload.toolCallId, publicLabel: event.payload.publicLabel });
        return;
      case "proposal_authorized":
        dispatch({ type: "proposal_authorized", sequence, runId: event.payload.runId, attemptId: event.payload.attemptId, logicalMessageId: event.payload.logicalMessageId });
        return;
      case "response_started":
        dispatch({ type: "response_started", sequence, runId: event.payload.runId, attemptId: event.payload.attemptId, logicalMessageId: event.payload.logicalMessageId });
        return;
      case "response_delta":
        dispatch({ type: "response_delta", sequence, runId: event.payload.runId, attemptId: event.payload.attemptId, logicalMessageId: event.payload.logicalMessageId, text: event.payload.text, provisional: true });
        return;
      case "response_finished":
        dispatch({ type: "response_finished", sequence, runId: event.payload.runId, attemptId: event.payload.attemptId, logicalMessageId: event.payload.logicalMessageId });
        return;
      case "response_discarded":
        dispatch({ type: "response_discarded", sequence, runId: event.payload.runId, attemptId: event.payload.attemptId, logicalMessageId: event.payload.logicalMessageId, reason: event.payload.reason });
        return;
      case "artifact_committed":
        dispatch({ type: "artifact_committed", sequence, artifact: event.payload });
        return;
      case "scoring_progress":
        dispatch({ type: "scoring_progress", sequence, runId: event.payload.runId });
        setScoringProgress(event.payload);
        return;
      case "reporting_started":
        dispatch({ type: "reporting_started", sequence, runId: event.payload.runId });
        return;
      case "message_committed":
        dispatch({ type: "message_committed", sequence, runId: event.payload.runId, attemptId: event.payload.attemptId, logicalMessageId: event.payload.logicalMessageId, message: event.payload.message });
        return;
      case "run_failed":
        dispatch({ type: "run_failed", sequence, runId: event.payload.runId });
        setError(event.payload.userMessage);
        await refresh();
        return;
      case "run_completed":
        dispatch({ type: "run_completed", sequence, runId: event.payload.runId });
        await refresh();
        return;
      default:
        event satisfies never;
    }
  }, [refresh]);

  const handleTerminalRun = useCallback(async (terminal: AgentRunStreamStatus) => {
    if (terminal.status === "failed") {
      dispatch({ type: "run_failed", runId: terminal.id });
      setError(terminal.userMessage ?? "答案已接收，但 Agent 本轮未完成。你可以恢复原 Run，无需重新提交答案。");
    }
    await refresh();
  }, [refresh]);

  const { connectionState, retry: retryConnection } = useAgentRunStream({
    interviewId,
    run,
    afterSequence: hydratedRunSequence,
    onEvent: handleRunEvent,
    onTerminal: handleTerminalRun,
    resumeRun: resumeRunRequest,
  });

  const sendPendingAnswer = useCallback(async (answer: PendingAnswer) => {
    if (submissionInFlightRef.current) return;
    submissionInFlightRef.current = true;
    setSubmitting(true);
    setSubmissionFailed(false);
    setError(null);
    dispatch({ type: "candidate_retrying", localId: answer.localId });
    try {
      const response = await fetch(`/api/interviews/${interviewId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: answer.content, idempotencyKey: answer.idempotencyKey }),
      });
      if (!response.ok) throw new Error("Answer request failed");
      const data = await response.json() as {
        runId: string;
        runStatus: "running" | "completed" | "failed";
        message: { id: string; sequence: number; content: string };
      };
      dispatch({ type: "candidate_committed", localId: answer.localId, runId: data.runId, message: data.message });
      dispatch({ type: "run_accepted", runId: data.runId });
      clearPendingAnswer(sessionStorage, interviewId);
      setPendingAnswer(null);
      setRun({ id: data.runId, status: data.runStatus, exitReason: null, userMessage: null, lastEventSequence: 0 });
      if (data.runStatus !== "running") await refresh();
    } catch {
      dispatch({ type: "candidate_failed", localId: answer.localId });
      setSubmissionFailed(true);
    } finally {
      submissionInFlightRef.current = false;
      setSubmitting(false);
    }
  }, [interviewId, refresh]);

  useEffect(() => {
    if (status !== "active") {
      clearPendingAnswer(sessionStorage, interviewId);
      return;
    }
    const restored = loadPendingAnswer(sessionStorage, interviewId);
    if (!restored) return;
    setPendingAnswer(restored);
    setSubmissionFailed(true);
    dispatch({ type: "candidate_submitted", localId: restored.localId, content: restored.content });
    dispatch({ type: "candidate_failed", localId: restored.localId });
  }, [interviewId, status]);

  const submit = async () => {
    const content = draft.trim();
    if (!content || busy || pendingAnswer || submissionInFlightRef.current) return;
    const answer = { localId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(), content };
    savePendingAnswer(sessionStorage, interviewId, answer);
    setPendingAnswer(answer);
    dispatch({ type: "candidate_submitted", localId: answer.localId, content });
    setDraft("");
    await sendPendingAnswer(answer);
  };

  const recoverFailedRun = async () => {
    if (!run || run.status !== "failed" || runRecoveryInFlightRef.current) return;
    runRecoveryInFlightRef.current = true;
    setRecoveringRun(true);
    setError(null);
    try {
      await resumeRunRequest(run.id, new AbortController().signal);
      setRun({ ...run, status: "running", exitReason: null, userMessage: null, recoveryDisposition: "already_running" });
    } catch (recoveryError) {
      setError(recoveryError instanceof Error ? recoveryError.message : "原 Run 恢复失败，请稍后重试。答案不会被重复提交。");
    } finally {
      runRecoveryInFlightRef.current = false;
      setRecoveringRun(false);
    }
  };

  const retryCompletion = async () => {
    if (completionRetryInFlightRef.current) return;
    completionRetryInFlightRef.current = true;
    setRetryingCompletion(true);
    setError(null);
    try {
      await completionPolling.resumeNow();
      setCompletionRecoveryRequested(true);
      await refresh();
    } catch (recoveryError) {
      setError(recoveryError instanceof Error ? recoveryError.message : "评分或报告恢复失败，请稍后重试。");
    } finally {
      completionRetryInFlightRef.current = false;
      setRetryingCompletion(false);
    }
  };

  const end = async () => {
    if (endingRef.current) return;
    endingRef.current = true;
    setEnding(true);
    try {
      const response = await fetch(`/api/interviews/${interviewId}/end`, { method: "POST" });
      if (!response.ok) throw new Error("End request failed");
      await refresh();
    } catch {
      setError("结束面试失败，请重试。");
    } finally {
      endingRef.current = false;
      setEnding(false);
    }
  };

  const completed = ["completing", "scoring", "reporting", "completed", "failed"].includes(interviewStatus);
  const timeline = useMemo(() => buildInterviewRoomTimeline(room.messages), [room.messages]);
  const toggleThinking = useCallback((runId: string, expanded: boolean) => {
    dispatch({ type: "thinking_toggled", runId, expanded });
  }, []);
  const activeRunId = run?.id ?? null;
  const activeRunHasMessage = activeRunId ? room.messages.some((message) => message.runId === activeRunId) : false;
  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="flex h-16 items-center justify-between border-b px-6">
        <div className="flex items-center gap-3"><div className="flex size-9 items-center justify-center rounded-full bg-primary/10"><Bot className="size-5 text-primary" /></div><div><p className="font-semibold">AI 面试官</p><p className="text-xs text-muted-foreground">根据你的简历与回答动态追问 · 最多 20 轮</p></div></div>
        <div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => setResumeOpen(true)}><FileText className="size-4" />简历上下文</Button>{!completed && <Button variant="ghost" size="sm" onClick={end} disabled={ending}><LogOut className="size-4" />结束面试</Button>}</div>
      </header>

      <main className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col">
        <div className="flex-1 space-y-7 overflow-y-auto px-6 py-8">
          <InterviewTranscript
            timeline={timeline}
            turns={room.turns}
            activeRunId={activeRunId}
            busy={busy}
            onToggleThinking={toggleThinking}
          />
          {busy && activeRunId && !activeRunHasMessage && room.turns[activeRunId] ? <LiveTurnSlot
            runId={activeRunId}
            turn={room.turns[activeRunId]}
            active
            onToggleThinking={toggleThinking}
          /> : null}
          {busy && !run?.id && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />面试官正在思考下一步...</div>}
          {connectionState === "reconnecting" && <p className="text-sm text-amber-600">连接暂时中断，但 Run 仍在服务器运行；正在重连，已接收的正式消息不会丢失。</p>}
          {connectionState === "recovering" && <p className="text-sm text-amber-600">连接持续中断，正在执行一次受控 Run 恢复。</p>}
          {connectionState === "manual_retry" && <div className="flex items-center gap-3"><p className="text-sm text-amber-600">连接已中断，但不会重新提交答案。</p><Button variant="outline" size="sm" onClick={retryConnection}>重新连接</Button></div>}
          {submissionFailed && pendingAnswer && <div className="flex items-center gap-3"><p className="text-sm text-destructive">答案尚未确认送达。重试会沿用同一个提交标识，不会生成重复答案。</p><Button variant="outline" size="sm" disabled={submitting} onClick={() => void sendPendingAnswer(pendingAnswer)}>重试发送</Button></div>}
          {run?.status === "failed" && run.recoveryDisposition === "schedule" && <div className="flex items-center gap-3"><p className="text-sm text-destructive">答案已接收，但 Agent 本轮失败。</p><Button variant="outline" size="sm" disabled={recoveringRun} onClick={() => void recoverFailedRun()}>{recoveringRun ? <Loader2 className="size-4 animate-spin" /> : null}恢复原 Run</Button></div>}
          {run?.status === "failed" && run.recoveryDisposition === "cooldown" && <p className="text-sm text-amber-600">答案已保存，Agent Run 正在冷却，稍后可恢复。</p>}
          {runRecoveryExhausted && <p className="text-sm text-destructive">答案已保存，但 Agent Run 恢复次数已用尽，请联系支持人员处理。</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <div className="border-t bg-background p-5">
          {completed ? <div className="space-y-3"><InterviewCompletionProgress status={interviewStatus} progress={scoringProgress} onRetry={() => void retryCompletion()} retrying={completionRecoveryRequested || retryingCompletion || completionPolling.resuming} />{completionPolling.timedOut && <div className="grid grid-cols-2 gap-2"><Button variant="outline" onClick={() => void completionPolling.refreshNow().catch(() => setError("面试状态刷新失败，请稍后重试。"))}>手动刷新状态</Button><Button variant="outline" onClick={completionPolling.resumePolling}>继续自动检查</Button></div>}{interviewStatus === "completed" && <Button className="w-full" onClick={() => router.push(`/interviews/${interviewId}/report`)}>查看报告</Button>}</div> : <div className="relative"><Textarea value={draft} onChange={(event) => setDraft(event.target.value)} disabled={busy || runRecoveryExhausted || Boolean(pendingAnswer)} rows={4} placeholder="输入你的回答。你也可以说明希望结束面试。" className="resize-none pr-14" onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void submit(); }} /><Button size="icon" className="absolute bottom-3 right-3" onClick={submit} disabled={busy || runRecoveryExhausted || Boolean(pendingAnswer) || !draft.trim()}><Send className="size-4" /></Button><p className="mt-2 text-xs text-muted-foreground">⌘ / Ctrl + Enter 提交</p></div>}
        </div>
      </main>
      <InterviewResumeContextSheet open={resumeOpen} onOpenChange={setResumeOpen} snapshot={resumeSnapshot} currentQuestion={room.messages.filter((message) => message.role === "assistant").at(-1)?.content ?? ""} />
    </div>
  );
}
