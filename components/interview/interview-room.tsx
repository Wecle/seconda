"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  BrainCircuit,
  CheckCircle2,
  ChevronDown,
  FileBarChart2,
  Lightbulb,
  Loader2,
  Puzzle,
  RotateCcw,
  Send,
  SkipForward,
  Sparkles,
  Square,
  UserRound,
} from "lucide-react";
import { UserAvatarMenu, type UserAvatarMenuUser } from "@/components/auth/user-avatar-menu";
import { BrandIcon } from "@/components/brand/brand-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { useTranslation } from "@/lib/i18n/context";
import { parseInterviewRoomEventData, parseInterviewRoomPayload } from "@/lib/interview/client/opening-stream";
import type { InterviewRoomQueryView, InterviewRoomPhase } from "@/lib/interview/projections/types";
import { Markdown } from "@/components/ui/markdown";
import { MagneticHighlightRail } from "./magnetic-highlight-rail";

interface InterviewRoomProps {
  view: InterviewRoomQueryView;
  user: UserAvatarMenuUser;
}

function reasoningSummary(text: string, running: boolean) {
  const visible = running ? text.trimEnd() : text;
  const lines = visible.split("\n");
  return (running ? lines.at(-1) : lines[0])?.trim() || (running ? "Thinking…" : "Reasoning");
}

function ReasoningRow({ text, running }: { text: string; running: boolean }) {
  const [userToggled, setUserToggled] = useState<boolean | null>(null);
  const expanded = userToggled !== null ? userToggled : running;
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (running && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  }, [text, running]);

  return (
    <article className="flex items-start gap-3.5 animate-in fade-in slide-in-from-bottom-2 duration-300">
      {/* Brain Icon Avatar */}
      <div className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-muted-foreground/20 to-muted-foreground/10 text-foreground ring-1 ring-border/80">
        <BrainCircuit className={running ? "size-4 text-primary animate-pulse" : "size-4 text-primary"} />
      </div>

      <div className="min-w-0 max-w-[90%] flex-1">
        <div className="overflow-hidden rounded-xl border border-border/70 bg-card/60 shadow-2xs transition-all hover:border-border">
          <button
            type="button"
            onClick={() => setUserToggled(!expanded)}
            className="flex w-full cursor-pointer items-center justify-between gap-2.5 px-3.5 py-2 text-left text-xs transition-colors hover:bg-muted/40"
          >
            <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden text-muted-foreground">
              <span
                className={`size-2 shrink-0 rounded-full bg-primary ${
                  running ? "animate-ping" : "opacity-80"
                }`}
              />
              <span className="shrink-0 font-medium text-foreground/80">
                {running ? "思考中" : "思考链路"}
              </span>

              {/* Summary text with smooth downward glide */}
              <div
                className={`flex min-w-0 flex-1 items-center gap-1.5 transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                  expanded
                    ? "pointer-events-none translate-y-3.5 opacity-0"
                    : "translate-y-0 opacity-100"
                }`}
              >
                <span aria-hidden="true" className="size-0.5 shrink-0 rounded-full bg-muted-foreground/50" />
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground/80">
                  {reasoningSummary(text, running)}
                </span>
              </div>
            </div>
            <ChevronDown
              className={`size-3.5 shrink-0 text-muted-foreground/70 transition-transform duration-350 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                expanded ? "rotate-180" : ""
              }`}
            />
          </button>

          <div
            className={`grid transition-[grid-template-rows,opacity] duration-350 ease-[cubic-bezier(0.16,1,0.3,1)] ${
              expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
            }`}
          >
            <div className="overflow-hidden">
              <div className="border-t border-border/50 bg-muted/20 px-3.5 py-2.5">
                <div
                  ref={scrollContainerRef}
                  className={`max-h-64 overflow-y-auto overscroll-contain border-l-2 border-primary/40 pl-3 pr-1 font-mono text-[12px] leading-relaxed text-muted-foreground whitespace-pre-wrap break-words [overflow-wrap:anywhere] transition-all duration-400 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                    expanded ? "translate-y-0 opacity-100" : "-translate-y-3.5 opacity-0"
                  }`}
                >
                  {text}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

function QuestionTipCard({ tip }: { tip: string }) {
  const [expanded, setExpanded] = useState(true);
  const { t } = useTranslation();

  return (
    <div className="mt-3.5 pt-3 border-t border-border/60">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full cursor-pointer items-center justify-between gap-2 text-xs font-medium text-amber-700 dark:text-amber-400 hover:opacity-80 transition-opacity"
      >
        <span className="flex items-center gap-1.5">
          <Lightbulb className="size-3.5" />
          {t.interview.tip}
        </span>
        <ChevronDown
          className={`size-3.5 transition-transform duration-300 ease-out ${
            expanded ? "rotate-180" : ""
          }`}
        />
      </button>

      <div
        className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${
          expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="overflow-hidden">
          <div className="mt-2 rounded-lg bg-amber-500/8 border border-amber-500/20 p-3 text-xs leading-relaxed text-amber-950 dark:text-amber-200">
            <Markdown content={tip} variant="amber" />
          </div>
        </div>
      </div>
    </div>
  );
}

function PhaseStatus({ phase, label }: { phase: InterviewRoomPhase; label: string }) {
  const failed = phase === "run_failed" || phase === "invalid_state";
  const pending =
    phase === "initializing" ||
    phase === "generating_question" ||
    phase === "evaluating_answer" ||
    phase === "completing";

  return (
    <div className="flex items-center gap-3.5 pl-0.5 animate-in fade-in duration-300" role="status" aria-live="polite">
      <div className="grid size-8 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
        {pending ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> : null}
        {failed ? <AlertCircle className="size-4 text-destructive" /> : null}
      </div>
      <div
        className={`flex items-center gap-2.5 rounded-xl border px-3.5 py-2 text-xs font-medium ${
          failed
            ? "border-destructive/30 bg-destructive/5 text-destructive"
            : "border-primary/20 bg-primary/5 text-primary"
        }`}
      >
        {pending ? (
          <div className="flex items-center gap-0.5">
            <span className="size-1 rounded-full bg-primary animate-bounce [animation-delay:-0.3s]" />
            <span className="size-1 rounded-full bg-primary animate-bounce [animation-delay:-0.15s]" />
            <span className="size-1 rounded-full bg-primary animate-bounce" />
          </div>
        ) : null}
        <span>{label}</span>
      </div>
    </div>
  );
}

export function InterviewRoom({ view, user }: InterviewRoomProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const initialPhaseRef = useRef(view.room.phase);
  const [currentView, setCurrentView] = useState(view);
  const [answer, setAnswer] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const submissionRef = useRef<{ signature: string; key: string } | null>(null);
  const answerAcceptedRef = useRef(false);
  const openingRequestRef = useRef(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const { room, transcript } = currentView;

  const lastTranscriptItem = transcript.at(-1);
  const latestIncompleteReasoning = transcript.findLast((item) => item.type === "reasoning" && !item.complete);
  const lastTranscriptVersion =
    lastTranscriptItem?.type === "reasoning"
      ? `${lastTranscriptItem.endSequence}:${lastTranscriptItem.content.length}:${lastTranscriptItem.complete}`
      : String(lastTranscriptItem?.sequence ?? 0);

  const progress =
    room.phase === "completed" || room.phase === "completing"
      ? 100
      : room.totalRounds > 0
      ? Math.max(0, Math.min(100, Math.round(((room.currentRound - 1) / room.totalRounds) * 100)))
      : 0;

  const turns = transcript
    .filter((item): item is Extract<typeof item, { type: "question" }> => item.type === "question")
    .map((question, index) => {
      const answer = transcript.find(
        (item): item is Extract<typeof item, { type: "answer" }> =>
          item.type === "answer" && item.questionId === question.questionId,
      );
      const isCurrent = question.questionId === room.currentQuestion?.id;
      return {
        questionId: question.questionId,
        roundIndex: index + 1,
        topic: isCurrent ? room.currentQuestion?.topic : undefined,
        questionContent: question.content,
        answerContent: answer ? (answer.skipped ? t.interview.skippedAnswer : answer.content) : undefined,
        isSkipped: answer?.skipped ?? false,
        isAnswered: !!answer,
        isCurrent,
      };
    });

  const phaseLabels: Record<InterviewRoomPhase, string> = {
    initializing: t.interview.roomPhases.initializing,
    generating_question: t.interview.roomPhases.generatingQuestion,
    awaiting_answer: t.interview.roomPhases.awaitingAnswer,
    evaluating_answer: t.interview.roomPhases.evaluatingAnswer,
    completing: t.interview.roomPhases.completing,
    completed: t.interview.roomPhases.completed,
    run_failed: t.interview.roomPhases.runFailed,
    invalid_state: t.interview.roomPhases.invalidState,
  };

  useLayoutEffect(() => {
    const viewport = scrollAreaRef.current?.querySelector<HTMLElement>("[data-slot='scroll-area-viewport']");
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }, [room.interviewId, lastTranscriptVersion]);

  useEffect(() => {
    setCurrentView(view);
  }, [view]);

  useEffect(() => {
    if (initialPhaseRef.current !== "completed" && room.phase === "completed") {
      router.push(`/interviews/${room.interviewId}/report`);
    }
  }, [room.phase, room.interviewId, router]);

  useEffect(() => {
    if (answerAcceptedRef.current && room.phase !== "awaiting_answer") {
      answerAcceptedRef.current = false;
      setSubmitting(false);
    }
  }, [room.phase]);

  useEffect(() => {
    const source = new EventSource(`/api/interviews/${view.room.interviewId}/events?after=0`);
    source.addEventListener("room", (event) => {
      try {
        const refreshed = parseInterviewRoomEventData((event as MessageEvent<string>).data);
        if (refreshed?.room.interviewId === view.room.interviewId) setCurrentView(refreshed);
      } catch {
        console.error("Received an invalid interview room event");
      }
    });
    return () => source.close();
  }, [view.room.interviewId]);

  useEffect(() => {
    if (openingRequestRef.current || (room.phase !== "initializing" && room.phase !== "generating_question")) return;
    openingRequestRef.current = true;
    fetch(`/api/interviews/${room.interviewId}/opening`, { method: "POST" })
      .then((response) => {
        if (!response.ok) throw new Error("Interview opening failed to start");
      })
      .catch((error) => {
        openingRequestRef.current = false;
        console.error("Failed to start interview opening", error instanceof Error ? error.name : "Unknown error");
      });
  }, [room.interviewId, room.phase]);

  async function submitCurrentAnswer(skipped: boolean) {
    if (!room.currentQuestion || !room.canSubmitAnswer || submitting) return;
    const content = skipped ? "" : answer.trim();
    if (!skipped && !content) return;
    const signature = `${room.currentQuestion.id}:${skipped}:${content}`;
    if (submissionRef.current?.signature !== signature) {
      submissionRef.current = { signature, key: crypto.randomUUID() };
    }
    setSubmitting(true);
    setSubmissionError(null);
    answerAcceptedRef.current = true;
    let accepted = false;
    try {
      const response = await fetch(`/api/interviews/${room.interviewId}/answers`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": submissionRef.current.key,
        },
        body: JSON.stringify({
          questionId: room.currentQuestion.id,
          skipped,
          ...(skipped ? {} : { content }),
        }),
      });
      if (!response.ok) throw new Error("Answer submission failed");
      if (!skipped) setAnswer("");
      submissionRef.current = null;
      accepted = true;
    } catch (error) {
      answerAcceptedRef.current = false;
      setSubmissionError(t.interview.answerSubmissionFailed);
      console.error("Failed to submit interview answer", error instanceof Error ? error.name : "Unknown error");
    } finally {
      if (!accepted) setSubmitting(false);
    }
  }

  async function retryRun() {
    if (!room.retryableRunId || submitting) return;
    setSubmitting(true);
    setSubmissionError(null);
    try {
      const response = await fetch(
        `/api/interviews/${room.interviewId}/runs/${room.retryableRunId}/retry`,
        { method: "POST" },
      );
      if (!response.ok) throw new Error("Interview run retry failed");
    } catch (error) {
      setSubmissionError(t.interview.questionLoadFailed);
      console.error("Failed to retry interview run", error instanceof Error ? error.name : "Unknown error");
    } finally {
      setSubmitting(false);
    }
  }

  async function endInterview() {
    if (!room.canEnd || submitting || !window.confirm(t.interview.endInterviewConfirm)) return;
    setSubmitting(true);
    setSubmissionError(null);
    try {
      const response = await fetch(`/api/interviews/${room.interviewId}/end`, { method: "POST" });
      if (!response.ok) throw new Error("End interview failed");
      const refreshed = parseInterviewRoomPayload(await response.json());
      if (!refreshed) throw new Error("End interview response is invalid");
      setCurrentView(refreshed);
    } catch (error) {
      setSubmissionError(t.interview.endInterviewFailed);
      console.error("Failed to end interview", error instanceof Error ? error.name : "Unknown error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative flex h-dvh min-h-0 flex-col overflow-hidden bg-background text-foreground selection:bg-primary/20">
      {/* Left Magnetic Progressive Highlight Rail with Piano Keys Navigation */}
      <MagneticHighlightRail turns={turns} scrollContainerRef={scrollAreaRef} />

      {/* Header */}
      <header className="sticky top-0 z-20 shrink-0 border-b border-border/80 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-15 max-w-4xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/dashboard"
              className="flex shrink-0 items-center gap-2.5 font-semibold tracking-tight transition-opacity hover:opacity-90"
            >
              <BrandIcon size={28} priority />
              <span className="hidden font-bold tracking-tight sm:inline">Seconda</span>
            </Link>

            <div className="h-4 w-px bg-border/80" aria-hidden="true" />

            <div className="min-w-0">
              <h1
                title={room.resumeTitle || t.interview.agentInterview}
                className="truncate text-sm font-semibold tracking-tight"
              >
                {room.resumeTitle || t.interview.agentInterview}
              </h1>
              <p className="truncate text-xs text-muted-foreground">
                {t.interview.questionOf
                  .replace("{current}", String(room.currentRound))
                  .replace("{total}", String(room.totalRounds))}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2 sm:gap-2.5">
            <Badge
              variant={room.phase === "run_failed" || room.phase === "invalid_state" ? "destructive" : "secondary"}
              className="max-w-28 truncate font-medium"
            >
              {phaseLabels[room.phase]}
            </Badge>

            {room.canEnd ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={submitting}
                onClick={endInterview}
                className="hidden h-8 gap-1.5 text-xs text-muted-foreground hover:bg-muted/80 hover:text-foreground sm:inline-flex"
              >
                <Square className="size-3.5" />
                <span>{t.interview.endInterview}</span>
              </Button>
            ) : null}

            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground hover:text-foreground"
              asChild
              aria-label={t.interview.returnDashboard}
            >
              <Link href="/dashboard">
                <ArrowLeft className="size-4" />
              </Link>
            </Button>

            <UserAvatarMenu user={user} panelAlign="right" avatarSize="sm" />
          </div>
        </div>

        {/* Smooth Glow Progress Bar */}
        <div
          className="relative h-1 w-full bg-muted/60 overflow-hidden"
          role="progressbar"
          aria-label={t.interview.interviewProgress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
        >
          <div
            className="h-full bg-gradient-to-r from-primary/80 to-primary transition-all duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      </header>

      {/* Main Conversation Stream Area */}
      <ScrollArea ref={scrollAreaRef} className="min-h-0 flex-1">
        <main className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-4 py-6 sm:px-6 md:py-8">
          <div className="space-y-6">
            {transcript.map((item) => {
              if (item.type === "reasoning") {
                const running =
                  item === latestIncompleteReasoning &&
                  (room.phase === "generating_question" || room.phase === "evaluating_answer");
                return (
                  <ReasoningRow
                    key={`reasoning-${item.runId}-${item.step}-${item.attempt}-${item.blockIndex}`}
                    text={item.content}
                    running={running}
                  />
                );
              }

              if (item.type === "answer") {
                return (
                  <article
                    key={`answer-${item.answerId}`}
                    className="flex items-start justify-end gap-3.5 animate-in fade-in slide-in-from-bottom-2 duration-300"
                  >
                    <div className="min-w-0 max-w-[85%] space-y-1">
                      <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
                        <span className="font-medium">你 (候选人)</span>
                      </div>
                      <div
                        className={`rounded-2xl rounded-tr-xs px-4.5 py-3 shadow-xs [overflow-wrap:anywhere] ${
                          item.skipped
                            ? "border border-dashed border-border bg-muted/40 text-muted-foreground text-xs italic"
                            : "bg-primary text-primary-foreground text-sm leading-relaxed"
                        }`}
                      >
                        {item.skipped ? (
                          <p className="whitespace-pre-wrap break-words">
                            {t.interview.skippedAnswer}
                          </p>
                        ) : (
                          <Markdown content={item.content} variant="inverted" />
                        )}
                      </div>
                    </div>

                    <div className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl border border-border/80 bg-card text-foreground shadow-2xs">
                      <UserRound className="size-4 text-muted-foreground" />
                    </div>
                  </article>
                );
              }

              if (item.type === "skill") {
                const label =
                  item.status === "loaded"
                    ? t.interview.skillLoaded.replace("{name}", item.name)
                    : t.interview.skillLoadFailed.replace("{name}", item.name);
                return (
                  <div
                    key={`skill-${item.runId}-${item.sequence}`}
                    className="flex items-center gap-2 pl-12 text-xs animate-in fade-in slide-in-from-bottom-1 duration-200"
                  >
                    <div className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-muted/30 px-2.5 py-1 text-muted-foreground transition-colors hover:bg-muted/60">
                      <Puzzle className="size-3.5 text-primary/70" />
                      <span className="font-mono text-[11px]">{label}</span>
                      {item.status === "loaded" ? (
                        <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                          <CheckCircle2 className="size-3" />
                        </span>
                      ) : null}
                    </div>
                  </div>
                );
              }

              if (item.type === "closing") {
                return (
                  <article
                    key={`closing-${item.sequence}`}
                    className="flex items-start gap-3.5 animate-in fade-in slide-in-from-bottom-2 duration-300"
                  >
                    <div className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl bg-gradient-to-tr from-primary to-blue-600 text-primary-foreground shadow-xs ring-2 ring-primary/20">
                      <Sparkles className="size-4" />
                    </div>
                    <div className="min-w-0 max-w-[88%] rounded-2xl rounded-tl-xs border border-border/80 bg-card p-4 sm:p-5 shadow-xs">
                      <Markdown content={item.content} className="text-[15px] leading-7 text-foreground/95" />
                    </div>
                  </article>
                );
              }

              const isCurrent = item.questionId === room.currentQuestion?.id;
              return (
                <article
                  key={`question-${item.questionId}`}
                  id={`interview-turn-${item.questionId}`}
                  data-turn-id={item.questionId}
                  className="scroll-mt-24 flex items-start gap-3.5 animate-in fade-in slide-in-from-bottom-2 duration-300"
                >
                  {/* Modern Interviewer Persona Avatar */}
                  <div className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl bg-gradient-to-tr from-primary to-blue-600 text-primary-foreground shadow-xs ring-2 ring-primary/20">
                    <Sparkles className="size-4" />
                  </div>

                  <div className="min-w-0 max-w-[88%] space-y-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-semibold text-foreground">{t.interview.aiInterviewer}</span>
                      {isCurrent && room.currentQuestion?.topic ? (
                        <>
                          <span className="text-muted-foreground/50">·</span>
                          <Badge
                            variant="secondary"
                            className="rounded-md border border-primary/20 bg-primary/5 px-2 py-0.5 text-[11px] font-medium text-primary break-words"
                          >
                            {room.currentQuestion.topic}
                          </Badge>
                        </>
                      ) : null}
                    </div>

                    <div className="rounded-2xl rounded-tl-xs border border-border/80 bg-card p-4 sm:p-5 shadow-xs transition-all">
                      <Markdown content={item.content} className="text-[15px] leading-7 text-foreground/95" />

                      {isCurrent && room.currentQuestion?.tip ? (
                        <QuestionTipCard tip={room.currentQuestion.tip} />
                      ) : null}
                    </div>
                  </div>
                </article>
              );
            })}

            {room.phase !== "awaiting_answer" && room.phase !== "completed" ? (
              <div className="space-y-3">
                <PhaseStatus phase={room.phase} label={phaseLabels[room.phase]} />
                {room.phase === "run_failed" && room.retryableRunId ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={submitting}
                    onClick={() => void retryRun()}
                    className="ml-11.5 h-8 gap-1.5 text-xs shadow-xs"
                  >
                    {submitting ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
                    <span>{t.common.retry}</span>
                  </Button>
                ) : null}
                {room.phase === "completing" && room.canRetryCompletion ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={submitting}
                    onClick={async () => {
                      setSubmitting(true);
                      try {
                        await fetch(`/api/interviews/${room.interviewId}/completion/retry`, { method: "POST" });
                      } finally {
                        setSubmitting(false);
                      }
                    }}
                    className="ml-11.5 h-8 gap-1.5 text-xs shadow-xs"
                  >
                    {submitting ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
                    <span>{t.common.retry}</span>
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        </main>
      </ScrollArea>

      {/* Completed Banner or Floating Composer Dock */}
      {room.phase === "completed" ? (
        <div className="shrink-0 border-t border-border/80 bg-card/95 p-4 backdrop-blur-md">
          <div className="mx-auto flex max-w-3xl flex-col items-center justify-between gap-3 sm:flex-row">
            <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
              <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
              <span>{t.interview.completedBannerDescription}</span>
            </div>
            <div className="flex w-full shrink-0 items-center justify-end gap-2 sm:w-auto">
              <Button variant="outline" size="sm" asChild>
                <Link href="/dashboard">{t.interview.returnDashboard}</Link>
              </Button>
              <Button size="sm" className="gap-1.5 font-medium shadow-xs" asChild>
                <Link href={`/interviews/${room.interviewId}/report`}>
                  <FileBarChart2 className="size-3.5" />
                  {t.interview.viewFullReport}
                </Link>
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <footer className="sticky bottom-0 z-20 shrink-0 border-t border-border/80 bg-background/85 p-3 backdrop-blur-md md:p-4">
          <div className="mx-auto max-w-3xl">
            {submissionError ? (
              <p className="mb-2 text-sm text-destructive" role="alert">{submissionError}</p>
            ) : null}
            <div className="overflow-hidden rounded-2xl border border-border/80 bg-card/90 shadow-lg ring-1 ring-black/5 dark:ring-white/5 transition-all focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/20">
              <Textarea
                value={answer}
                disabled={!room.canSubmitAnswer || submitting}
                onChange={(event) => setAnswer(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    void submitCurrentAnswer(false);
                  }
                }}
                aria-label={t.interview.answerPlaceholder}
                placeholder={room.canSubmitAnswer ? t.interview.answerPlaceholder : phaseLabels[room.phase]}
                className="max-h-36 min-h-16 resize-none border-0 bg-transparent px-3.5 py-2.5 text-sm shadow-none focus-visible:ring-0 placeholder:text-muted-foreground/60"
              />

              <div className="flex items-center justify-between border-t border-border/40 bg-muted/20 px-3 py-2 text-xs">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <span className="font-mono text-[11px]">{answer.length} 字</span>
                  <span className="size-1 rounded-full bg-border" />
                  <span className="hidden sm:inline-flex items-center gap-1 text-[11px]">
                    <kbd className="rounded border bg-card px-1 py-0.5 text-[10px] font-mono shadow-2xs">
                      ⌘ / Ctrl
                    </kbd>
                    +
                    <kbd className="rounded border bg-card px-1 py-0.5 text-[10px] font-mono shadow-2xs">
                      Enter
                    </kbd>
                    发送
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!room.canSkip || submitting}
                    onClick={() => void submitCurrentAnswer(true)}
                    aria-label={t.interview.skipQuestion}
                    className="h-8 gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <SkipForward className="size-3.5" />
                    <span>{t.interview.skipQuestion}</span>
                  </Button>

                  <Button
                    size="sm"
                    disabled={!room.canSubmitAnswer || submitting || !answer.trim()}
                    onClick={() => void submitCurrentAnswer(false)}
                    aria-label={t.interview.submitAnswer}
                    className="h-8 gap-1.5 px-3 text-xs font-medium shadow-xs"
                  >
                    {submitting ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                    <span>{t.interview.submitAnswer}</span>
                  </Button>
                </div>
              </div>
            </div>

            <div className="mt-2 flex items-center justify-between px-1 text-xs text-muted-foreground">
              <span>{t.interview.submitShortcut}</span>
              <Button
                variant="link"
                size="sm"
                disabled={!room.canEnd || submitting}
                onClick={endInterview}
                className="h-auto px-0 py-0 sm:hidden"
              >
                {t.interview.endInterview}
              </Button>
            </div>
          </div>
        </footer>
      )}
    </div>
  );
}
