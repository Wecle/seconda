"use client";

import Link from "next/link";
import { useLayoutEffect, useRef } from "react";
import {
  AlertCircle,
  ArrowLeft,
  Bot,
  Loader2,
  Send,
  Sparkles,
  UserRound,
} from "lucide-react";
import { UserAvatarMenu, type UserAvatarMenuUser } from "@/components/auth/user-avatar-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { useTranslation } from "@/lib/i18n/context";
import type { InterviewRoomQueryView, InterviewRoomPhase } from "@/lib/interview/projections/types";

interface InterviewRoomProps {
  view: InterviewRoomQueryView;
  user: UserAvatarMenuUser;
}

function PhaseStatus({ phase, label }: { phase: InterviewRoomPhase; label: string }) {
  const failed = phase === "run_failed" || phase === "invalid_state";
  const pending = phase === "initializing"
    || phase === "generating_question"
    || phase === "evaluating_answer"
    || phase === "completing";

  return (
    <div className="flex gap-3" role="status" aria-live="polite">
      <div className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-foreground text-background">
        <Bot className="size-4" />
      </div>
      <div className="flex min-h-8 items-center gap-2 text-sm text-muted-foreground">
        {pending ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> : null}
        {failed ? <AlertCircle className="size-4 text-destructive" /> : null}
        <span>{label}</span>
      </div>
    </div>
  );
}

export function InterviewRoom({ view, user }: InterviewRoomProps) {
  const { t } = useTranslation();
  const { room, transcript } = view;
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const progress = room.phase === "completed" || room.phase === "completing"
    ? 100
    : room.totalRounds > 0
      ? Math.max(0, Math.min(100, Math.round(((room.currentRound - 1) / room.totalRounds) * 100)))
      : 0;
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
  }, [room.interviewId]);

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-background">
      <header className="shrink-0 border-b bg-card">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/dashboard" className="flex shrink-0 items-center gap-2 font-semibold tracking-tight">
              <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
                <Sparkles className="size-4" />
              </span>
              <span className="hidden sm:inline">Seconda</span>
            </Link>
            <div className="h-6 w-px bg-border" aria-hidden="true" />
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold">{t.interview.agentInterview}</h1>
              <p className="truncate text-xs text-muted-foreground">
                {t.interview.questionOf
                  .replace("{current}", String(room.currentRound))
                  .replace("{total}", String(room.totalRounds))}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Badge
              variant={room.phase === "run_failed" || room.phase === "invalid_state" ? "destructive" : "secondary"}
              className="max-w-28 truncate"
            >
              {phaseLabels[room.phase]}
            </Badge>
            <Button variant="ghost" size="icon" asChild aria-label={t.interview.returnDashboard}>
              <Link href="/dashboard"><ArrowLeft className="size-4" /></Link>
            </Button>
            <UserAvatarMenu user={user} panelAlign="right" avatarSize="sm" />
          </div>
        </div>
        <div
          className="h-0.5 bg-muted"
          role="progressbar"
          aria-label={t.interview.interviewProgress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
        >
          <div
            className="h-full bg-primary transition-[width] motion-reduce:transition-none"
            style={{ width: `${progress}%` }}
          />
        </div>
      </header>

      <ScrollArea ref={scrollAreaRef} className="min-h-0 flex-1">
        <main className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-4 py-8 sm:px-6 md:py-10">
          <div className="space-y-7">
            {transcript.map((item) => {
              if (item.type === "answer") {
                return (
                  <article key={`answer-${item.answerId}`} className="flex justify-end gap-3">
                    <div className="max-w-[85%] min-w-0 rounded-xl bg-muted px-4 py-2.5 [overflow-wrap:anywhere]">
                      <p className="whitespace-pre-wrap break-words text-sm leading-6">
                        {item.skipped ? t.interview.skippedAnswer : item.content}
                      </p>
                    </div>
                    <div className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border bg-card">
                      <UserRound className="size-4" />
                    </div>
                  </article>
                );
              }

              const isCurrent = item.questionId === room.currentQuestion?.id;
              return (
                <article key={`question-${item.questionId}`} className="flex gap-3">
                  <div className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-foreground text-background">
                    <Bot className="size-4" />
                  </div>
                  <div className="min-w-0 max-w-[85%] space-y-2 pt-1 [overflow-wrap:anywhere]">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{t.interview.aiInterviewer}</span>
                      {isCurrent && room.currentQuestion?.topic ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="break-words">{room.currentQuestion.topic}</span>
                        </>
                      ) : null}
                    </div>
                    <p className="whitespace-pre-wrap break-words text-[15px] leading-7 text-foreground">
                      {item.content}
                    </p>
                    {isCurrent && room.currentQuestion?.tip ? (
                      <details className="group text-sm text-muted-foreground">
                        <summary className="w-fit cursor-pointer list-none rounded-md py-1 font-medium hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                          {t.interview.tip}
                        </summary>
                        <p className="mt-1 break-words border-l pl-3 leading-6 [overflow-wrap:anywhere]">
                          {room.currentQuestion.tip}
                        </p>
                      </details>
                    ) : null}
                  </div>
                </article>
              );
            })}

            {room.phase !== "awaiting_answer" ? (
              <PhaseStatus phase={room.phase} label={phaseLabels[room.phase]} />
            ) : null}
          </div>
        </main>
      </ScrollArea>

      <div className="shrink-0 border-t bg-card/95 p-3 backdrop-blur md:p-4">
        <div className="mx-auto max-w-3xl">
          <div className="flex items-end gap-2 rounded-xl border bg-background p-2 shadow-sm focus-within:ring-2 focus-within:ring-ring/30">
            <Textarea
              disabled
              aria-label={t.interview.answerPlaceholder}
              placeholder={t.interview.answerPlaceholder}
              className="max-h-40 min-h-11 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
            />
            <Button size="icon" disabled aria-label={t.interview.submitAnswer}>
              <Send className="size-4" />
            </Button>
          </div>
          <p className="mt-2 text-center text-[11px] text-muted-foreground">
            {t.interview.readOnlyMilestone}
          </p>
        </div>
      </div>
    </div>
  );
}
