"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { useTranslation } from "@/lib/i18n/context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { InterviewAnswerPanel } from "@/components/interview/interview-answer-panel";
import {
  Bot,
  FileText,
  LogOut,
  Lightbulb,
  Loader2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

interface InterviewData {
  id: string;
  resumeVersionId: string;
  level: string;
  type: string;
  language: string;
  questionCount: number;
  persona: string;
  status: string;
  overallScore: number | null;
  reportJson: unknown;
}

interface QuestionData {
  id: string;
  interviewId: string;
  questionIndex: number;
  questionType: string;
  topic: string | null;
  question: string;
  tip: string | null;
  answerText: string | null;
  answeredAt: string | null;
  score: {
    understanding: number;
    expression: number;
    logic: number;
    depth: number;
    authenticity: number;
    reflection: number;
    overall: number;
  } | null;
  feedback: unknown;
}

export default function InterviewRoomPage() {
  const router = useRouter();
  const { interviewId } = useParams();
  const { t } = useTranslation();
  const [interview, setInterview] = useState<InterviewData | null>(null);
  const [questions, setQuestions] = useState<QuestionData[]>([]);
  const [answerText, setAnswerText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isTipExpanded, setIsTipExpanded] = useState(false);

  useEffect(() => {
    fetch(`/api/interviews/${interviewId}`)
      .then((r) => r.json())
      .then((data) => {
        setInterview(data.interview);
        setQuestions(data.questions);
        setLoading(false);
      });
  }, [interviewId]);

  const currentQ = questions.find((q) => !q.answeredAt);
  const answeredCount = questions.filter((q) => q.answeredAt).length;
  const percentComplete = Math.round(
    (answeredCount / (interview?.questionCount || 1)) * 100,
  );
  const levelLabels: Record<string, string> = {
    junior: t.interview.levels.Junior,
    mid: t.interview.levels.Mid,
    senior: t.interview.levels.Senior,
  };
  const levelLabel = interview?.level
    ? (levelLabels[interview.level.toLowerCase()] ?? interview.level)
    : "";

  useEffect(() => {
    setIsTipExpanded(false);
  }, [currentQ?.id]);

  async function handleSubmit() {
    const normalizedAnswer = answerText.trim();
    if (!currentQ || !normalizedAnswer) return;
    setSubmitting(true);
    try {
      await fetch(`/api/interviews/${interviewId}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questionId: currentQ.id,
          answerText: normalizedAnswer,
        }),
      });
      const refreshRes = await fetch(`/api/interviews/${interviewId}`);
      const refreshData = await refreshRes.json();
      setQuestions(refreshData.questions);
      setInterview(refreshData.interview);
      setAnswerText("");
      if (!refreshData.questions.find((q: QuestionData) => !q.answeredAt)) {
        await fetch(`/api/interviews/${interviewId}/complete`, {
          method: "POST",
        });
        router.push(`/interviews/${interviewId}/report`);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSkip() {
    if (!currentQ) return;
    setSubmitting(true);
    try {
      await fetch(`/api/interviews/${interviewId}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId: currentQ.id, answerText: "" }),
      });
      const refreshRes = await fetch(`/api/interviews/${interviewId}`);
      const refreshData = await refreshRes.json();
      setQuestions(refreshData.questions);
      setInterview(refreshData.interview);
      setAnswerText("");
      if (!refreshData.questions.find((q: QuestionData) => !q.answeredAt)) {
        await fetch(`/api/interviews/${interviewId}/complete`, {
          method: "POST",
        });
        router.push(`/interviews/${interviewId}/report`);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!currentQ) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="text-center space-y-3">
          <p className="text-lg font-semibold">{t.interview.allAnswered}</p>
          <Button
            onClick={() => router.push(`/interviews/${interviewId}/report`)}
          >
            {t.interview.viewReport}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Header */}
      <header className="border-b bg-card px-6 py-4 shrink-0">
        <div className="flex items-center justify-between">
          {/* Left */}
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-blue-600 text-white">
              <Bot className="size-5" />
            </div>
            <div>
              <h1 className="text-base font-semibold leading-tight">
                {t.interview.session}
              </h1>
              <p className="text-sm text-muted-foreground">
                {currentQ?.topic || currentQ?.questionType || "Interview"}
              </p>
            </div>
          </div>

          {/* Center — Progress */}
          <div className="hidden md:flex flex-col items-center gap-1.5 min-w-48">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-semibold tracking-wide">
                {t.interview.questionOf
                  .replace("{current}", String(answeredCount + 1))
                  .replace("{total}", String(interview?.questionCount))}
              </span>
              <span>•</span>
              <span>
                {t.interview.percentComplete.replace(
                  "{percent}",
                  String(percentComplete),
                )}
              </span>
            </div>
            <Progress value={percentComplete} className="h-1.5 w-48" />
          </div>

          {/* Right */}
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{levelLabel}</Badge>
            <Badge variant="outline">{currentQ?.topic}</Badge>
            <button className="hidden sm:flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors px-2">
              <FileText className="size-3.5" />
              {t.interview.resumeContext}
            </button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => router.push("/dashboard")}
            >
              <LogOut className="size-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden lg:flex-row">
        {/* Left Panel — AI Question */}
        <div className="h-1/2 w-full bg-muted/50 flex min-h-0 flex-col overflow-y-auto lg:h-auto lg:w-5/12 xl:w-1/3">
          <div className="flex-1 p-6 flex flex-col gap-6">
            {/* AI Avatar */}
            <div className="flex flex-col items-center gap-2 pt-2">
              <div className="relative">
                <div className="size-16 rounded-full bg-linear-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-xl font-bold">
                  AI
                </div>
                <div className="absolute bottom-0.5 right-0.5 size-3.5 rounded-full bg-green-500 border-2 border-background" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium">
                  {t.interview.aiInterviewer}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t.interview.askingNow}
                </p>
              </div>
            </div>

            {/* Question Bubble */}
            <div className="bg-card rounded-xl rounded-tl-none shadow-sm border p-5">
              <p className="text-sm leading-relaxed">{currentQ?.question}</p>
            </div>

            {/* Spacer */}
            <div className="flex-1" />

            {/* Tip Box */}
            {currentQ?.tip && (
              <div className="overflow-hidden rounded-xl border border-blue-200 bg-blue-50/50 transition-colors hover:bg-blue-50 dark:border-blue-800 dark:bg-blue-950/20 dark:hover:bg-blue-950/30">
                <button
                  type="button"
                  className="flex w-full items-center gap-3 p-4 text-left"
                  onClick={() => setIsTipExpanded((prev) => !prev)}
                  aria-expanded={isTipExpanded}
                >
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-400">
                    <Lightbulb className="size-4" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-blue-900 dark:text-blue-100">
                        {t.interview.tip}
                      </p>
                      <div className="flex items-center gap-1.5 text-xs font-medium text-blue-600 dark:text-blue-400">
                        <span>
                          {isTipExpanded
                            ? t.interview.collapseTip
                            : t.interview.expandTip}
                        </span>
                        <ChevronDown
                          className={`size-3.5 transition-transform duration-200 ${
                            isTipExpanded ? "rotate-180" : ""
                          }`}
                        />
                      </div>
                    </div>
                  </div>
                </button>
                <div
                  className={`grid transition-[grid-template-rows] duration-200 ease-out ${
                    isTipExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                  }`}
                >
                  <div className="overflow-hidden">
                    <div className="px-4 pb-4 pt-0 text-sm leading-relaxed text-blue-700 dark:text-blue-300">
                      <div className="pl-11">{currentQ.tip}</div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <InterviewAnswerPanel
          placeholder={t.interview.answerPlaceholder}
          helperText={t.interview.markdownSupported}
          answerText={answerText}
          submitting={submitting}
          resetKey={currentQ.id}
          skipLabel={t.interview.skipQuestion}
          audioLabel={t.interview.answerWithAudio}
          submitLabel={t.interview.submitAnswer}
          onAnswerChange={setAnswerText}
          onSkip={handleSkip}
          onSubmit={handleSubmit}
        />
      </div>
    </div>
  );
}
