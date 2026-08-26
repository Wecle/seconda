"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  History,
  Lightbulb,
  Loader2,
  RefreshCw,
  Sparkles,
  TrendingUp,
  UserRound,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
    description: "准确把握问题核心与业务/技术意图",
  },
  expression: {
    labelZh: "表达力",
    labelEn: "Expression",
    description: "语言流畅、术语规范、重点突出",
  },
  logic: {
    labelZh: "逻辑性",
    labelEn: "Logic",
    description: "结构严谨、条理清晰、因果推导严密",
  },
  depth: {
    labelZh: "深度",
    labelEn: "Depth",
    description: "触及底层原理、权衡考量与架构设计",
  },
  authenticity: {
    labelZh: "真实性",
    labelEn: "Authenticity",
    description: "结合真实项目经历、量化数据与具体挑战",
  },
  reflection: {
    labelZh: "反思力",
    labelEn: "Reflection",
    description: "展现自省复盘、持续学习与经验沉淀",
  },
};

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
      // Re-trigger polling
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
      <div className="flex min-h-screen flex-col items-center justify-center p-6 text-center">
        <Loader2 className="mb-4 size-10 animate-spin text-primary" />
        <h2 className="text-xl font-semibold">{t.interview.completionProcessing}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {t.interview.completionDescription}
        </p>
      </div>
    );
  }

  if (data?.job?.status === "failed" && !data.report) {
    return (
      <div className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center p-6 text-center">
        <AlertCircle className="mb-4 size-12 text-destructive" />
        <h2 className="text-xl font-semibold">报告生成未能完成</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          评分或报告生成服务遇到临时异常。所有已回答记录已安全持久化，可点击下方按钮重新生成。
        </p>
        {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
        <div className="mt-6 flex gap-3">
          <Button onClick={handleRetry} disabled={retrying}>
            {retrying ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            重新生成报告
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

  const getScoreBadgeVariant = (score: number) => {
    if (score >= 85) return "default";
    if (score >= 70) return "secondary";
    return "outline";
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" asChild>
              <Link href="/dashboard" aria-label={t.interview.returnDashboard}>
                <ArrowLeft className="size-4" />
              </Link>
            </Button>
            <div>
              <h1 className="text-base font-semibold leading-none">{t.report.title}</h1>
              <p className="mt-1 text-xs text-muted-foreground">
                {data?.interview.targetRole} · {data?.interview.targetLevel}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href={`/interviews/${interviewId}`}>
                <History className="size-3.5" />
                {t.report.reviewInterview}
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href="/dashboard">{t.report.dashboard}</Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-8 px-4 py-8 sm:px-6">
        {/* Top Summary Banner / Overall Score Card */}
        <div className="grid gap-6 md:grid-cols-3">
          {/* Overall Score */}
          <Card className="flex flex-col justify-between md:col-span-1">
            <CardHeader className="pb-2">
              <CardDescription>{t.report.overallPerformance}</CardDescription>
              <CardTitle className="text-2xl">
                {report?.scoreStatus === "scored" && report.overallScore !== null ? (
                  <div className="flex items-baseline gap-2">
                    <span className="text-5xl font-bold tracking-tight text-primary">
                      {report.overallScore}
                    </span>
                    <span className="text-lg text-muted-foreground">/ 100</span>
                  </div>
                ) : (
                  <span className="text-xl font-medium text-muted-foreground">
                    无可评分有效回答
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {report?.scoreStatus === "scored" && report.overallScore !== null ? (
                <div className="mt-2 flex items-center gap-2">
                  <Badge variant={getScoreBadgeVariant(report.overallScore)}>
                    {report.overallScore >= 85
                      ? t.report.strongPerformer
                      : report.overallScore >= 70
                        ? t.report.goodProgress
                        : t.report.needsImprovement}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    基于 {questions.filter((q) => q.scores).length} 道有效回答综合评定
                  </span>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  本场面试未检测到足够的可评分有效回答（题目被跳过或提前结束）。
                </p>
              )}
            </CardContent>
          </Card>

          {/* Key Strengths & Key Improvements */}
          <Card className="md:col-span-2">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Sparkles className="size-4 text-primary" />
                {t.report.analysisSummary}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <p className="leading-relaxed text-muted-foreground">
                {summary?.overallSummary || t.report.noAnalysisData}
              </p>

              {summary?.keyStrengths && summary.keyStrengths.length > 0 ? (
                <div>
                  <h4 className="mb-1.5 flex items-center gap-1.5 font-medium text-foreground">
                    <CheckCircle2 className="size-3.5 text-emerald-500" />
                    {t.report.topStrength}
                  </h4>
                  <ul className="list-inside list-disc space-y-1 text-xs text-muted-foreground">
                    {summary.keyStrengths.map((st, i) => (
                      <li key={i}>{st}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {summary?.keyImprovements && summary.keyImprovements.length > 0 ? (
                <div>
                  <h4 className="mb-1.5 flex items-center gap-1.5 font-medium text-foreground">
                    <TrendingUp className="size-3.5 text-amber-500" />
                    {t.report.criticalFocus}
                  </h4>
                  <ul className="list-inside list-disc space-y-1 text-xs text-muted-foreground">
                    {summary.keyImprovements.map((imp, i) => (
                      <li key={i}>{imp}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>

        {/* 6 Dimensions Radar / Breakdown */}
        {averages ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t.report.competencyBreakdown}</CardTitle>
              <CardDescription>
                六维综合能力分析（各项均为 0.0 - 10.0 分，由各题单维确定性平均计算）
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {(Object.keys(DIMENSION_CONFIG) as Array<keyof ReportDimensionAverages>).map((key) => {
                  const score = averages[key] ?? 0;
                  const cfg = DIMENSION_CONFIG[key];
                  const label = locale === "en" ? cfg.labelEn : cfg.labelZh;
                  const percent = Math.min(100, Math.max(0, Math.round(score * 10)));

                  return (
                    <div
                      key={key}
                      className="flex flex-col justify-between rounded-lg border bg-card/50 p-3.5"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-sm text-foreground">{label}</span>
                        <span className="font-bold text-base text-primary">
                          {score.toFixed(1)}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{cfg.description}</p>
                      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full bg-primary transition-all"
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        ) : null}

        {/* Long-term Recommendations */}
        {summary?.recommendations ? (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Lightbulb className="size-4 text-amber-500" />
                复盘提升建议
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                {summary.recommendations}
              </p>
            </CardContent>
          </Card>
        ) : null}

        {/* Detailed Per-Question Analysis */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold tracking-tight">{t.report.detailedAnalysis}</h3>
            <span className="text-xs text-muted-foreground">共 {questions.length} 道问题</span>
          </div>

          <div className="space-y-4">
            {questions.map((q) => {
              const isExpanded = expandedQuestions[q.id] ?? true;
              const isSkipped = q.status === "skipped" || q.answerStatus === "skipped";

              return (
                <Card key={q.id} className="overflow-hidden">
                  <div
                    onClick={() => toggleQuestion(q.id)}
                    className="flex cursor-pointer items-start justify-between p-4 transition hover:bg-muted/50"
                  >
                    <div className="space-y-1 pr-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">第 {q.sequence} 题</Badge>
                        <span className="text-xs font-medium text-muted-foreground">
                          [{q.topic}]
                        </span>
                        {isSkipped ? (
                          <Badge variant="secondary">已跳过</Badge>
                        ) : q.overall !== null ? (
                          <Badge variant="default">得分: {q.overall.toFixed(1)} / 10</Badge>
                        ) : null}
                      </div>
                      <p className="pt-1 text-sm font-medium leading-6 text-foreground">
                        {q.question}
                      </p>
                    </div>
                    <Button variant="ghost" size="icon" className="shrink-0">
                      {isExpanded ? (
                        <ChevronDown className="size-4" />
                      ) : (
                        <ChevronRight className="size-4" />
                      )}
                    </Button>
                  </div>

                  {isExpanded ? (
                    <CardContent className="border-t bg-muted/20 pt-4 space-y-4 text-sm">
                      {/* Candidate Answer */}
                      <div className="space-y-1.5">
                        <h5 className="flex items-center gap-1.5 font-medium text-xs text-muted-foreground">
                          <UserRound className="size-3.5" />
                          {t.report.yourAnswer}
                        </h5>
                        <div className="rounded-md border bg-background p-3 text-sm leading-relaxed [overflow-wrap:anywhere]">
                          {isSkipped ? (
                            <span className="text-xs text-muted-foreground italic">已跳过此题</span>
                          ) : (
                            q.answer || <span className="text-xs text-muted-foreground">无回答记录</span>
                          )}
                        </div>
                      </div>

                      {/* Question 6-Dimension Scores */}
                      {q.scores ? (
                        <div className="space-y-2">
                          <h5 className="font-medium text-xs text-muted-foreground">本题六维评分</h5>
                          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-6">
                            {(
                              Object.keys(DIMENSION_CONFIG) as Array<
                                keyof ReportDimensionAverages
                              >
                            ).map((dimKey) => {
                              const dimScore = q.scores?.[dimKey] ?? 0;
                              const cfg = DIMENSION_CONFIG[dimKey];
                              const label = locale === "en" ? cfg.labelEn : cfg.labelZh;

                              return (
                                <div
                                  key={dimKey}
                                  className="rounded border bg-background px-2.5 py-1.5 text-center"
                                >
                                  <div className="text-[11px] text-muted-foreground">{label}</div>
                                  <div className="font-bold text-sm text-primary">{dimScore}</div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}

                      {/* Feedback: Strengths, Improvements, Advice */}
                      {q.feedback ? (
                        <div className="grid gap-3 pt-1 md:grid-cols-3">
                          {q.feedback.strengths && q.feedback.strengths.length > 0 ? (
                            <div className="rounded-md border bg-background p-3">
                              <span className="flex items-center gap-1 font-medium text-xs text-emerald-600">
                                <CheckCircle2 className="size-3.5" />
                                {t.report.strengths}
                              </span>
                              <ul className="mt-1.5 list-inside list-disc space-y-1 text-xs text-muted-foreground">
                                {q.feedback.strengths.map((s, i) => (
                                  <li key={i}>{s}</li>
                                ))}
                              </ul>
                            </div>
                          ) : null}

                          {q.feedback.improvements && q.feedback.improvements.length > 0 ? (
                            <div className="rounded-md border bg-background p-3">
                              <span className="flex items-center gap-1 font-medium text-xs text-amber-600">
                                <TrendingUp className="size-3.5" />
                                {t.report.improvements}
                              </span>
                              <ul className="mt-1.5 list-inside list-disc space-y-1 text-xs text-muted-foreground">
                                {q.feedback.improvements.map((imp, i) => (
                                  <li key={i}>{imp}</li>
                                ))}
                              </ul>
                            </div>
                          ) : null}

                          {q.feedback.advice ? (
                            <div className="rounded-md border bg-background p-3">
                              <span className="flex items-center gap-1 font-medium text-xs text-primary">
                                <Lightbulb className="size-3.5" />
                                {t.report.advice}
                              </span>
                              <p className="mt-1.5 text-xs text-muted-foreground">
                                {q.feedback.advice}
                              </p>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </CardContent>
                  ) : null}
                </Card>
              );
            })}
          </div>
        </section>
      </main>
    </div>
  );
}
