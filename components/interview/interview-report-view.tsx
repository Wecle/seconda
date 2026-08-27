"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  Compass,
  History,
  Lightbulb,
  Loader2,
  RefreshCw,
  RotateCcw,
  Sparkles,
  TrendingUp,
  UserRound,
} from "lucide-react";
import { BrandIcon } from "@/components/brand/brand-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/lib/i18n/context";

export interface ReportDimensionAverages {
  understanding: number;
  expression: number;
  logic: number;
  depth: number;
  authenticity: number;
  reflection: number;
}

export interface ReportSummaryData {
  overallSummary: string;
  keyStrengths: string[];
  keyImprovements: string[];
  recommendations: string;
}

export interface QuestionReportItem {
  id: string;
  sequence: number;
  kind: "main" | "follow_up";
  topic: string;
  question: string;
  tip: string | null;
  status: string;
  answer: string | null;
  answerStatus: string | null;
  scores: {
    understanding: number;
    expression: number;
    logic: number;
    depth: number;
    authenticity: number;
    reflection: number;
  } | null;
  overall: number | null;
  feedback: {
    strengths?: string[];
    improvements?: string[];
    advice?: string;
  } | null;
  scoreStatus: string | null;
}

export interface InterviewReportPayload {
  status: string;
  interview: {
    id: string;
    status: string;
    targetRole: string;
    targetLevel: string;
    interviewType: string;
    language: string;
    persona: string;
    startedAt: string | null;
    completedAt: string | null;
  };
  job: {
    id: string;
    status: "pending" | "scoring" | "reporting" | "completed" | "failed";
    errorJson?: unknown;
  } | null;
  report: {
    id: string;
    overallScore: number | null;
    dimensionAveragesJson: ReportDimensionAverages | null;
    summaryJson: ReportSummaryData;
    scoreStatus: "scored" | "no_scorable_answers";
    generatedAt: string;
  } | null;
  questions?: QuestionReportItem[];
}

const DIMENSION_CONFIG: Record<
  keyof ReportDimensionAverages,
  { labelZh: string; labelEn: string; description: string }
> = {
  understanding: {
    labelZh: "理解力",
    labelEn: "Understanding",
    description: "准确把握问题核心与业务/技术底层意图",
  },
  expression: {
    labelZh: "表达力",
    labelEn: "Expression",
    description: "结构严谨、术语规范、要点清晰突出",
  },
  logic: {
    labelZh: "逻辑性",
    labelEn: "Logic",
    description: "因果推导严密、架构拆分具备自洽性",
  },
  depth: {
    labelZh: "深度",
    labelEn: "Depth",
    description: "触及底层原理、权衡考量与边界治理",
  },
  authenticity: {
    labelZh: "真实性",
    labelEn: "Authenticity",
    description: "结合真实复杂场景、量化数据与工程权衡",
  },
  reflection: {
    labelZh: "反思力",
    labelEn: "Reflection",
    description: "展现自省复盘、故障定界与持续迭代认知",
  },
};

function getScoreGrade(score: number, t: ReturnType<typeof useTranslation>["t"]) {
  if (score >= 85) {
    return {
      label: t.report.strongPerformer,
      color: "text-emerald-600 dark:text-emerald-400",
      bg: "bg-emerald-500/10 border-emerald-500/20",
    };
  }
  if (score >= 70) {
    return {
      label: t.report.goodProgress,
      color: "text-primary",
      bg: "bg-primary/10 border-primary/20",
    };
  }
  return {
    label: t.report.needsImprovement,
    color: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-500/10 border-amber-500/20",
  };
}

export function InterviewReportView({
  interviewId,
  initialData,
}: {
  interviewId: string;
  initialData?: InterviewReportPayload | null;
}) {
  const { t, locale } = useTranslation();
  const [data, setData] = useState<InterviewReportPayload | null>(initialData ?? null);
  const [loading, setLoading] = useState(!initialData || !initialData.report);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedQuestions, setExpandedQuestions] = useState<Record<string, boolean>>({});

  const fetchReport = useCallback(async () => {
    try {
      const res = await fetch(`/api/interviews/${interviewId}/report`);
      if (!res.ok) {
        throw new Error("Failed to load interview report");
      }
      const json = (await res.json()) as InterviewReportPayload;
      setData(json);
      return json;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load report");
      return null;
    } finally {
      setLoading(false);
    }
  }, [interviewId]);

  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;

    if (!data?.report && data?.interview?.status !== "completed") {
      void fetchReport();
      timer = setInterval(async () => {
        const updated = await fetchReport();
        if (updated?.report || updated?.job?.status === "failed") {
          if (timer) clearInterval(timer);
        }
      }, 2500);
    }

    return () => {
      if (timer) clearInterval(timer);
    };
  }, [fetchReport, data?.report, data?.interview?.status]);

  const handleRetry = async () => {
    setRetrying(true);
    setError(null);
    try {
      const res = await fetch(`/api/interviews/${interviewId}/completion/retry`, {
        method: "POST",
      });
      if (!res.ok) {
        throw new Error("Failed to retry report generation");
      }
      setLoading(true);
      await fetchReport();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Retry failed");
    } finally {
      setRetrying(false);
    }
  };

  const toggleQuestion = (id: string) => {
    setExpandedQuestions((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  if (loading && !data?.report) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-6 text-center bg-background text-foreground">
        <div className="grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary mb-4 animate-pulse">
          <Loader2 className="size-7 animate-spin text-primary" />
        </div>
        <h2 className="text-xl font-semibold tracking-tight">{t.interview.completionProcessing}</h2>
        <p className="mt-2 text-sm text-muted-foreground max-w-md">
          {t.interview.completionDescription}
        </p>
      </div>
    );
  }

  if (data?.job?.status === "failed" && !data.report) {
    return (
      <div className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center p-6 text-center bg-background text-foreground">
        <div className="grid size-14 place-items-center rounded-2xl bg-destructive/10 text-destructive mb-4">
          <AlertCircle className="size-7 text-destructive" />
        </div>
        <h2 className="text-xl font-semibold tracking-tight">报告生成未能完成</h2>
        <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
          评分或报告生成服务遇到临时异常。所有已回答记录已安全持久化，可点击下方按钮重新生成。
        </p>
        {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
        <div className="mt-6 flex gap-3">
          <Button onClick={handleRetry} disabled={retrying} className="gap-2 shadow-xs">
            {retrying ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            <span>重新生成报告</span>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/dashboard">{t.interview.returnDashboard}</Link>
          </Button>
        </div>
      </div>
    );
  }

  const report = data?.report;
  const questions = data?.questions ?? [];
  const averages = report?.dimensionAveragesJson;
  const summary = report?.summaryJson;
  const scorableAnswersCount = questions.filter((q) => q.scores !== null).length;

  const overallScoreVal = report?.scoreStatus === "scored" && report.overallScore !== null ? report.overallScore : null;
  const grade = overallScoreVal !== null ? getScoreGrade(overallScoreVal, t) : null;

  return (
    <div className="relative min-h-screen bg-background text-foreground selection:bg-primary/20 pb-16">
      {/* Executive Header */}
      <header className="sticky top-0 z-20 shrink-0 border-b border-border/80 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
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
              <div className="flex items-center gap-2">
                <h1 className="truncate text-sm font-semibold tracking-tight">{t.report.title}</h1>
                <Badge
                  variant="outline"
                  className="hidden rounded-full border-primary/20 bg-primary/5 px-2 py-0 text-[11px] font-medium text-primary sm:inline-flex"
                >
                  {t.report.statuses.completed}
                </Badge>
              </div>
              <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                <span>{data?.interview.targetRole}</span>
                <span className="size-1 rounded-full bg-muted-foreground/40" />
                <span>{data?.interview.targetLevel}</span>
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs shadow-xs" asChild>
              <Link href={`/interviews/${interviewId}`}>
                <History className="size-3.5" />
                <span>{t.report.reviewInterview}</span>
              </Link>
            </Button>
            <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-foreground" asChild>
              <Link href="/dashboard" aria-label={t.interview.returnDashboard}>
                <ArrowLeft className="size-4" />
              </Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Main Report Body */}
      <main className="mx-auto max-w-5xl space-y-8 px-4 py-8 sm:px-6">
        {/* Section 1: Hero Scoreboard & Executive Summary */}
        <section className="grid gap-6 lg:grid-cols-12 animate-in fade-in slide-in-from-bottom-2 duration-300">
          {/* Left: Overall Score Card */}
          <div className="flex flex-col justify-between rounded-2xl border border-border/80 bg-card p-6 shadow-xs lg:col-span-4">
            <div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="font-medium uppercase tracking-wider">{t.report.overallPerformance}</span>
                {grade ? (
                  <Badge variant="outline" className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${grade.bg} ${grade.color}`}>
                    {grade.label}
                  </Badge>
                ) : null}
              </div>

              <div className="mt-4 flex items-baseline gap-2">
                {overallScoreVal !== null ? (
                  <>
                    <span className="text-6xl font-extrabold tracking-tight text-primary font-mono">
                      {overallScoreVal}
                    </span>
                    <span className="text-xl font-medium text-muted-foreground">/ 100</span>
                  </>
                ) : (
                  <span className="text-xl font-medium text-muted-foreground">无可评分有效回答</span>
                )}
              </div>

              <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
                {overallScoreVal !== null
                  ? `基于 ${scorableAnswersCount} 道有效回答综合加权评定`
                  : "本场面试未检测到足够的可评分有效回答（题目被跳过或提前结束）。"}
              </p>
            </div>

            <div className="mt-6 border-t border-border/60 pt-4 grid grid-cols-2 gap-3 text-xs">
              <div>
                <span className="text-muted-foreground">作答考题</span>
                <p className="font-semibold text-foreground mt-0.5">
                  {questions.length} 轮 / {scorableAnswersCount} 题有效
                </p>
              </div>
              <div>
                <span className="text-muted-foreground">{t.report.meta.status}</span>
                <p className="font-semibold text-emerald-600 dark:text-emerald-400 mt-0.5">
                  {t.report.statuses.completed}
                </p>
              </div>
            </div>
          </div>

          {/* Right: Executive Summary & Highlights */}
          <div className="flex flex-col justify-between rounded-2xl border border-border/80 bg-card p-6 shadow-xs lg:col-span-8 space-y-5">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <Sparkles className="size-4 text-primary" />
                <span>{t.report.analysisSummary}</span>
              </div>
              <p className="mt-3 text-[14px] leading-relaxed text-foreground/90 font-normal">
                {summary?.overallSummary || t.report.noAnalysisData}
              </p>
            </div>

            {/* Dual Column: Strengths & Improvements */}
            <div className="grid gap-3.5 sm:grid-cols-2 pt-2">
              {summary?.keyStrengths && summary.keyStrengths.length > 0 ? (
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-xs">
                  <div className="flex items-center gap-1.5 font-semibold text-emerald-800 dark:text-emerald-300">
                    <CheckCircle2 className="size-3.5" />
                    <span>{t.report.topStrength}</span>
                  </div>
                  <ul className="mt-2 space-y-1.5 text-emerald-950/80 dark:text-emerald-200/80 leading-relaxed">
                    {summary.keyStrengths.map((item, idx) => (
                      <li key={idx} className="flex items-start gap-1.5">
                        <span className="shrink-0 size-1 rounded-full bg-emerald-500 mt-1.5" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {summary?.keyImprovements && summary.keyImprovements.length > 0 ? (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-xs">
                  <div className="flex items-center gap-1.5 font-semibold text-amber-800 dark:text-amber-300">
                    <TrendingUp className="size-3.5" />
                    <span>{t.report.criticalFocus}</span>
                  </div>
                  <ul className="mt-2 space-y-1.5 text-amber-950/80 dark:text-amber-200/80 leading-relaxed">
                    {summary.keyImprovements.map((item, idx) => (
                      <li key={idx} className="flex items-start gap-1.5">
                        <span className="shrink-0 size-1 rounded-full bg-amber-500 mt-1.5" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </div>
        </section>

        {/* Section 2: 6-Dimension Competency Matrix */}
        {averages ? (
          <section className="space-y-4 animate-in fade-in slide-in-from-bottom-3 duration-400">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold tracking-tight">{t.report.competencyBreakdown}</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  六维综合能力分析（各项均为 0.0 - 10.0 分，由各题单维确定性平均计算）
                </p>
              </div>
              <Badge variant="outline" className="hidden sm:inline-flex text-[11px] text-muted-foreground font-normal">
                等权重计算 (1/6)
              </Badge>
            </div>

            <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
              {(Object.keys(DIMENSION_CONFIG) as Array<keyof ReportDimensionAverages>).map((key) => {
                const score = averages[key] ?? 0;
                const cfg = DIMENSION_CONFIG[key];
                const label = locale === "en" ? cfg.labelEn : cfg.labelZh;
                const percent = Math.min(100, Math.max(0, Math.round(score * 10)));
                const dimGrade = getScoreGrade(score * 10, t);

                return (
                  <div
                    key={key}
                    className="flex flex-col justify-between rounded-xl border border-border/80 bg-card p-4 shadow-2xs transition-all hover:border-primary/40 hover:shadow-xs"
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-sm text-foreground">{label}</span>
                        <div className="flex items-baseline gap-1">
                          <span className="font-bold text-lg font-mono text-primary">{score.toFixed(1)}</span>
                          <span className="text-xs text-muted-foreground">/ 10</span>
                        </div>
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        {cfg.description}
                      </p>
                    </div>

                    <div className="mt-4 pt-2">
                      <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1.5">
                        <span>能力评级</span>
                        <span className={`font-medium ${dimGrade.color}`}>{dimGrade.label}</span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full bg-gradient-to-r from-primary/80 to-primary transition-all duration-500 ease-out"
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}

        {/* Section 3: Question-by-Question Deep Dive */}
        <section className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold tracking-tight">{t.report.detailedAnalysis}</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                深挖每道考题的回答表现、维度得分与考官诊断建议
              </p>
            </div>
            <span className="text-xs text-muted-foreground">共 {questions.length} 道考题</span>
          </div>

          <div className="space-y-4">
            {questions.map((q) => {
              const isExpanded = expandedQuestions[q.id] ?? true;
              const isSkipped = q.status === "skipped" || q.answerStatus === "skipped";

              return (
                <div
                  key={q.id}
                  className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-2xs transition-all hover:border-border"
                >
                  {/* Card Trigger Header */}
                  <button
                    type="button"
                    onClick={() => toggleQuestion(q.id)}
                    className="flex w-full cursor-pointer items-start justify-between gap-4 p-4 text-left transition-colors hover:bg-muted/30 sm:p-5"
                  >
                    <div className="space-y-1.5 min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className="rounded-md px-2 py-0.5 text-[11px] font-medium font-mono">
                          第 {q.sequence} 题
                        </Badge>
                        {q.topic ? (
                          <Badge
                            variant="secondary"
                            className="rounded-md border border-primary/20 bg-primary/5 px-2 py-0.5 text-[11px] font-medium text-primary"
                          >
                            {q.topic}
                          </Badge>
                        ) : null}
                        {isSkipped ? (
                          <Badge variant="secondary" className="rounded-md px-2 py-0.5 text-[11px]">
                            {t.interview.skippedAnswer}
                          </Badge>
                        ) : q.overall !== null ? (
                          <Badge
                            variant="secondary"
                            className="rounded-md px-2 py-0.5 text-[11px] font-mono font-semibold text-primary"
                          >
                            得分: {q.overall.toFixed(1)} / 10
                          </Badge>
                        ) : null}
                      </div>

                      <p className="text-[14.5px] font-medium leading-relaxed text-foreground/95 pt-0.5">
                        {q.question}
                      </p>
                    </div>

                    <ChevronDown
                      className={`size-4 shrink-0 text-muted-foreground/70 transition-transform duration-300 ease-out mt-1 ${
                        isExpanded ? "rotate-180" : ""
                      }`}
                    />
                  </button>

                  {/* Smooth Animated Accordion Body */}
                  <div
                    className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${
                      isExpanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                    }`}
                  >
                    <div className="overflow-hidden">
                      <div className="border-t border-border/60 bg-muted/15 p-4 sm:p-5 space-y-5 text-sm">
                        {/* 1. Candidate Answer */}
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                            <UserRound className="size-3.5" />
                            <span>{t.report.yourAnswer}</span>
                          </div>
                          <div className="rounded-xl border border-border/60 bg-background/80 p-3.5 text-xs leading-relaxed text-foreground/90 whitespace-pre-wrap [overflow-wrap:anywhere]">
                            {isSkipped ? (
                              <span className="text-xs text-muted-foreground italic">{t.interview.skippedAnswer}</span>
                            ) : (
                              q.answer || <span className="text-xs text-muted-foreground">无回答记录</span>
                            )}
                          </div>
                        </div>

                        {/* 2. 6-Dimension Score Row */}
                        {q.scores ? (
                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground">
                              <span>本题六维得分明细</span>
                              <span className="font-normal text-[11px]">单项满分 10</span>
                            </div>
                            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                              {(Object.keys(DIMENSION_CONFIG) as Array<keyof ReportDimensionAverages>).map((dimKey) => {
                                const dimScore = q.scores?.[dimKey] ?? 0;
                                const cfg = DIMENSION_CONFIG[dimKey];
                                const label = locale === "en" ? cfg.labelEn : cfg.labelZh;

                                return (
                                  <div
                                    key={dimKey}
                                    className="rounded-lg border border-border/70 bg-card px-2.5 py-2 text-center"
                                  >
                                    <div className="text-[11px] text-muted-foreground">{label}</div>
                                    <div className="font-bold text-sm font-mono text-primary mt-0.5">
                                      {dimScore}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ) : null}

                        {/* 3. Feedback Tri-Column */}
                        {q.feedback ? (
                          <div className="grid gap-3 pt-1 md:grid-cols-3">
                            {/* Strengths */}
                            {q.feedback.strengths && q.feedback.strengths.length > 0 ? (
                              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3.5">
                                <div className="flex items-center gap-1.5 font-semibold text-xs text-emerald-800 dark:text-emerald-300">
                                  <CheckCircle2 className="size-3.5" />
                                  <span>{t.report.strengths}</span>
                                </div>
                                <ul className="mt-2 space-y-1 text-xs text-emerald-950/80 dark:text-emerald-200/80 leading-relaxed">
                                  {q.feedback.strengths.map((s, idx) => (
                                    <li key={idx} className="flex items-start gap-1">
                                      <span className="shrink-0 size-1 rounded-full bg-emerald-500 mt-1.5" />
                                      <span>{s}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            ) : null}

                            {/* Improvements */}
                            {q.feedback.improvements && q.feedback.improvements.length > 0 ? (
                              <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3.5">
                                <div className="flex items-center gap-1.5 font-semibold text-xs text-amber-800 dark:text-amber-300">
                                  <TrendingUp className="size-3.5" />
                                  <span>{t.report.improvements}</span>
                                </div>
                                <ul className="mt-2 space-y-1 text-xs text-amber-950/80 dark:text-amber-200/80 leading-relaxed">
                                  {q.feedback.improvements.map((imp, idx) => (
                                    <li key={idx} className="flex items-start gap-1">
                                      <span className="shrink-0 size-1 rounded-full bg-amber-500 mt-1.5" />
                                      <span>{imp}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            ) : null}

                            {/* Advice */}
                            {q.feedback.advice ? (
                              <div className="rounded-xl border border-primary/20 bg-primary/5 p-3.5">
                                <div className="flex items-center gap-1.5 font-semibold text-xs text-primary">
                                  <Lightbulb className="size-3.5" />
                                  <span>{t.report.advice}</span>
                                </div>
                                <p className="mt-2 text-xs text-foreground/80 leading-relaxed">
                                  {q.feedback.advice}
                                </p>
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Section 4: Strategic Recommendations */}
        {summary?.recommendations ? (
          <section className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/5 via-card to-card p-6 shadow-xs animate-in fade-in slide-in-from-bottom-5 duration-600">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
              <Compass className="size-4" />
              <span>复盘提升建议</span>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground whitespace-pre-wrap">
              {summary.recommendations}
            </p>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4">
              <div className="text-xs text-muted-foreground">
                提示：坚持复盘报告，通常能更快提升下一轮面试表现。
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" className="gap-1.5 font-medium shadow-xs" asChild>
                  <Link href="/dashboard">
                    <RotateCcw className="size-3.5" />
                    <span>{t.report.startNewSession}</span>
                  </Link>
                </Button>
              </div>
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}
