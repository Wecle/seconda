"use client";

import Link from "next/link";
import { ArrowLeft, Bot, Clock3, MessageSquareText, Send, Sparkles } from "lucide-react";
import { UserAvatarMenu, type UserAvatarMenuUser } from "@/components/auth/user-avatar-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useTranslation } from "@/lib/i18n/context";
import type { InterviewRoomQueryView, InterviewRoomPhase } from "@/lib/interview/projections/types";

interface InterviewRoomProps {
  view: InterviewRoomQueryView;
  user: UserAvatarMenuUser;
}

export function InterviewRoom({ view, user }: InterviewRoomProps) {
  const { t } = useTranslation();
  const { room, transcript } = view;
  const progress = room.totalRounds > 0
    ? Math.round(((room.currentRound - 1) / room.totalRounds) * 100)
    : 0;
  const priorTranscript = transcript.filter((item) => (
    item.type !== "question" || item.questionId !== room.currentQuestion?.id
  ));
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

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-4">
            <Link href="/dashboard" className="flex items-center gap-2 font-semibold tracking-tight">
              <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Sparkles className="size-4" />
              </span>
              Seconda
            </Link>
            <Badge variant="secondary" className="hidden sm:inline-flex">
              {t.interview.agentInterview}
            </Badge>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/dashboard">
                <ArrowLeft className="size-4" />
                <span className="hidden sm:inline">{t.interview.returnDashboard}</span>
              </Link>
            </Button>
            <UserAvatarMenu user={user} panelAlign="right" />
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:px-8 lg:py-8">
        <div className="min-w-0 space-y-6">
          <section className="rounded-2xl border bg-card shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4 sm:px-7">
              <div>
                <p className="text-sm font-medium text-muted-foreground">{t.interview.session}</p>
                <h1 className="mt-1 text-xl font-semibold tracking-tight">
                  {t.interview.questionOf
                    .replace("{current}", String(room.currentRound))
                    .replace("{total}", String(room.totalRounds))}
                </h1>
              </div>
              <Badge variant={room.phase === "run_failed" || room.phase === "invalid_state" ? "destructive" : "outline"}>
                {phaseLabels[room.phase]}
              </Badge>
            </div>

            <div className="px-5 py-7 sm:px-7 sm:py-9">
              {room.currentQuestion ? (
                <div className="space-y-6">
                  <div className="flex items-start gap-4">
                    <div className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                      <Bot className="size-5" />
                    </div>
                    <div className="min-w-0 space-y-3">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">{t.interview.aiInterviewer}</span>
                        <span aria-hidden="true">·</span>
                        <span>{room.currentQuestion.topic}</span>
                      </div>
                      <p className="text-lg leading-8 text-foreground sm:text-xl sm:leading-9">
                        {room.currentQuestion.content}
                      </p>
                      {room.currentQuestion.tip ? (
                        <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm leading-6 text-muted-foreground">
                          <span className="font-medium text-foreground">{t.interview.tip}：</span>
                          {room.currentQuestion.tip}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="space-y-3 border-t pt-6">
                    <Textarea
                      disabled
                      placeholder={t.interview.answerPlaceholder}
                      className="min-h-36 resize-none bg-muted/30"
                    />
                    <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-xs leading-5 text-muted-foreground">
                        {t.interview.readOnlyMilestone}
                      </p>
                      <div className="flex gap-2">
                        <Button type="button" variant="outline" disabled>{t.interview.skipQuestion}</Button>
                        <Button type="button" disabled>
                          <Send className="size-4" />
                          {t.interview.submitAnswer}
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex min-h-56 flex-col items-center justify-center gap-3 text-center">
                  <Clock3 className="size-8 text-muted-foreground" />
                  <p className="font-medium">{phaseLabels[room.phase]}</p>
                  <p className="max-w-md text-sm leading-6 text-muted-foreground">
                    {t.interview.noCurrentQuestion}
                  </p>
                </div>
              )}
            </div>
          </section>

          {priorTranscript.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <MessageSquareText className="size-4" />
                  {t.interview.transcript}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {priorTranscript.map((item) => (
                  <div key={`${item.type}-${item.sequence}`} className="rounded-lg border p-4">
                    <p className="mb-2 text-xs font-medium text-muted-foreground">
                      {item.type === "question" ? t.interview.aiInterviewer : t.interview.yourAnswer}
                    </p>
                    <p className="whitespace-pre-wrap text-sm leading-6">
                      {item.type === "answer" && item.skipped ? t.interview.skippedAnswer : item.content}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </div>

        <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{t.interview.interviewProgress}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-baseline justify-between">
                <span className="text-3xl font-semibold tabular-nums">{progress}%</span>
                <span className="text-sm text-muted-foreground">
                  {room.currentRound} / {room.totalRounds}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${progress}%` }} />
              </div>
              <p className="text-sm leading-6 text-muted-foreground">
                {t.interview.refreshRecovery}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-2 p-5">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t.interview.interviewId}
              </p>
              <p className="break-all font-mono text-xs leading-5">{room.interviewId}</p>
            </CardContent>
          </Card>
        </aside>
      </main>
    </div>
  );
}
