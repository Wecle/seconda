"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, FileText, Loader2, LogOut, Send } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { InterviewResumeContextSheet } from "./interview-resume-context-sheet";
import type { ParsedResume } from "@/lib/resume/types";
import {
  useAgentRunStream,
  type AgentRunStreamEvent,
  type AgentRunStreamStatus,
} from "./use-agent-run-stream";

type AgentMessage = { id: string; sequence: number; role: string; kind: string; content: string };
type AgentRun = AgentRunStreamStatus;
type ResumeSnapshot = { id: string; versionNumber: number; originalFilename: string; originalFileUrl: string | null; parseStatus: string; parsedData: ParsedResume | null };

export function AgentInterviewRoom({ interviewId, initialMessages, initialRun, resumeSnapshot, status }: {
  interviewId: string;
  initialMessages: AgentMessage[];
  initialRun: AgentRun | null;
  resumeSnapshot: ResumeSnapshot | null;
  status: string;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState(initialMessages);
  const [run, setRun] = useState(initialRun);
  const [draft, setDraft] = useState("");
  const [provisional, setProvisional] = useState("");
  const [busy, setBusy] = useState(initialRun?.status === "running");
  const [ending, setEnding] = useState(false);
  const [resumeOpen, setResumeOpen] = useState(false);
  const [interviewStatus, setInterviewStatus] = useState(status);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/interviews/${interviewId}`, { cache: "no-store" });
    if (!response.ok) throw new Error("面试状态加载失败");
    const data = await response.json();
    setMessages(data.agentState?.messages ?? []);
    setInterviewStatus(data.interview.status);
    const latest = data.agentState?.latestRun ?? null;
    setRun(latest);
    return latest as AgentRun | null;
  }, [interviewId]);

  const handleRunEvent = useCallback(async (event: AgentRunStreamEvent) => {
    if (event.type === "text_delta") {
      const payload = event.payload as { text?: unknown };
      if (typeof payload?.text === "string") setProvisional((value) => value + payload.text);
      return;
    }
    if (event.type === "message_committed") {
      setProvisional("");
      await refresh();
      return;
    }
    if (event.type === "run_completed" || event.type === "run_failed") {
      setProvisional("");
      setBusy(false);
      if (event.type === "run_failed") {
        const payload = event.payload as { userMessage?: unknown };
        setError(typeof payload?.userMessage === "string"
          ? payload.userMessage
          : "本轮生成未完成，请重新提交或稍后重试。");
      }
      await refresh();
    }
  }, [refresh]);

  const handleTerminalRun = useCallback(async (terminal: AgentRunStreamStatus) => {
    setProvisional("");
    setBusy(false);
    if (terminal.status === "failed") {
      setError(`本轮处理已终止${terminal.exitReason ? `（${terminal.exitReason}）` : ""}。`);
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
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/interviews/${interviewId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, idempotencyKey: crypto.randomUUID() }),
    });
    if (!response.ok) {
      setBusy(false);
      setError("回答提交失败，请重试。");
      return;
    }
    setDraft("");
    const data = await response.json() as { runId: string };
    await refresh();
    setRun({ id: data.runId, status: "running", exitReason: null, lastEventSequence: 0 });
  };

  const end = async () => {
    if (ending) return;
    setEnding(true);
    const response = await fetch(`/api/interviews/${interviewId}/end`, { method: "POST" });
    if (response.ok) await refresh();
    else setError("结束面试失败，请重试。");
    setEnding(false);
  };

  const completed = ["completing", "reporting", "completed"].includes(interviewStatus);
  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="flex h-16 items-center justify-between border-b px-6">
        <div className="flex items-center gap-3"><div className="flex size-9 items-center justify-center rounded-full bg-primary/10"><Bot className="size-5 text-primary" /></div><div><p className="font-semibold">AI 面试官</p><p className="text-xs text-muted-foreground">根据你的简历与回答动态追问 · 最多 20 轮</p></div></div>
        <div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => setResumeOpen(true)}><FileText className="size-4" />简历上下文</Button>{!completed && <Button variant="ghost" size="sm" onClick={end} disabled={ending}><LogOut className="size-4" />结束面试</Button>}</div>
      </header>

      <main className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col">
        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-8">
          {messages.map((message) => <div key={message.id} className={message.role === "user" ? "ml-auto max-w-[80%]" : "max-w-[86%]"}><div className={message.role === "user" ? "rounded-2xl rounded-br-md bg-primary px-4 py-3 text-primary-foreground" : "rounded-2xl rounded-bl-md border bg-card px-5 py-4 shadow-sm"}><ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown></div></div>)}
          {provisional && <div className="max-w-[86%] rounded-2xl rounded-bl-md border bg-card px-5 py-4 opacity-80"><ReactMarkdown remarkPlugins={[remarkGfm]}>{provisional}</ReactMarkdown></div>}
          {busy && !provisional && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />面试官正在思考下一步...</div>}
          {connectionState === "reconnecting" && <p className="text-sm text-amber-600">连接正在恢复，已接收的正式消息不会丢失。</p>}
          {connectionState === "manual_retry" && <Button variant="outline" size="sm" onClick={retryConnection}>重新连接</Button>}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <div className="border-t bg-background p-5">
          {completed ? <div className="flex items-center justify-between rounded-xl border bg-card p-4"><div><p className="font-medium">本次面试已结束</p><p className="text-sm text-muted-foreground">系统正在整理评分与面试报告。</p></div><Button onClick={() => router.push(`/interviews/${interviewId}/report`)}>查看报告</Button></div> : <div className="relative"><Textarea value={draft} onChange={(event) => setDraft(event.target.value)} disabled={busy} rows={4} placeholder="输入你的回答。你也可以说明希望结束面试。" className="resize-none pr-14" onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void submit(); }} /><Button size="icon" className="absolute bottom-3 right-3" onClick={submit} disabled={busy || !draft.trim()}><Send className="size-4" /></Button><p className="mt-2 text-xs text-muted-foreground">⌘ / Ctrl + Enter 提交</p></div>}
        </div>
      </main>
      <InterviewResumeContextSheet open={resumeOpen} onOpenChange={setResumeOpen} snapshot={resumeSnapshot} currentQuestion={messages.filter((message) => message.role === "assistant").at(-1)?.content ?? ""} />
    </div>
  );
}
