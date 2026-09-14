"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  Award,
  Briefcase,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Compass,
  History,
  Lightbulb,
  Loader2,
  MessageSquare,
  MessageSquareQuote,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  Target,
  TrendingUp,
  UserRound,
  Copy,
} from "lucide-react";
import { toast } from "sonner";
import { BrandIcon } from "@/components/brand/brand-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/ui/markdown";
import { useTranslation } from "@/lib/i18n/context";

export interface ReportDimensionAverages {
  understanding: number;
  expression: number;
  logic: number;
  depth: number;
  authenticity: number;
  reflection: number;
}

export interface ReportHiringDecision {
  signal: "strong_hire" | "hire" | "leaning_hire" | "leaning_no_hire" | "no_hire";
  confidence: "high" | "medium" | "low";
  decisionRationale: string;
  keyTradeOffs: string;
}

export interface ReportDifferentiationRating {
  level: "template_worker" | "competent_practitioner" | "differentiated_expert";
  summary: string;
  earnedSecrets?: string[];
}

export interface ReportInnerMonologueItem {
  questionSequence: number;
  topic: string;
  triggerQuote: string;
  monologue: string;
}

export interface ReportRedTeamChallenge {
  hiddenAssumptions?: string[];
  blindSpots?: string[];
  devilsAdvocateRejectionReason?: string;
}

export interface ReportPriorityActionPlan72h {
  immediate24h: string;
  storybankAdjust48h: string;
  targetedDrill72h: string;
}

export interface ReportJobFitSkillAssessment {
  skillName: string;
  category: "must_have" | "nice_to_have";
  evaluation: "exceeded" | "satisfied" | "partially_met" | "untested";
  evidence: string;
}

export interface ReportJobFitAnalysis {
  overallFitRating: "strong_fit" | "workable" | "stretch" | "gap";
  fitSummary: string;
  skillsAssessment: ReportJobFitSkillAssessment[];
  criticalGaps: string[];
  recommendedReverseQuestions: string[];
}

export interface ReportSummaryData {
  overallSummary: string;
  keyStrengths: string[];
  keyImprovements: string[];
  recommendations: string;
  hiringDecision?: ReportHiringDecision;
  differentiationRating?: ReportDifferentiationRating;
  innerMonologues?: ReportInnerMonologueItem[];
  redTeamChallenge?: ReportRedTeamChallenge;
  priorityActionPlan72h?: ReportPriorityActionPlan72h;
  jobFitAnalysis?: ReportJobFitAnalysis;
}

export interface QuestionRewriteExample {
  improvedExcerpt: string;
  annotations: string[];
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
    rootCause?: "narrative_hoarding" | "conflict_avoidance" | "status_anxiety" | "surface_framework" | "story_first_mismatch" | "none";
    interviewerReaction?: string;
    rewriteExample?: QuestionRewriteExample;
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
      color: "text-emerald-700 dark:text-emerald-300",
      bg: "bg-emerald-500/10 border-emerald-500/30",
    };
  }
  if (score >= 70) {
    return {
      label: t.report.goodProgress,
      color: "text-primary",
      bg: "bg-primary/10 border-primary/25",
    };
  }
  return {
    label: t.report.needsImprovement,
    color: "text-amber-700 dark:text-amber-300",
    bg: "bg-amber-500/10 border-amber-500/30",
  };
}

function getHiringSignalBadge(
  signal: ReportHiringDecision["signal"],
  t: ReturnType<typeof useTranslation>["t"],
) {
  const configs = {
    strong_hire: {
      label: t.report.hiringDecision.signals.strong_hire,
      bg: "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300",
      dot: "bg-emerald-500",
    },
    hire: {
      label: t.report.hiringDecision.signals.hire,
      bg: "bg-blue-500/10 border-blue-500/30 text-blue-700 dark:text-blue-300",
      dot: "bg-blue-500",
    },
    leaning_hire: {
      label: t.report.hiringDecision.signals.leaning_hire,
      bg: "bg-cyan-500/10 border-cyan-500/30 text-cyan-700 dark:text-cyan-300",
      dot: "bg-cyan-500",
    },
    leaning_no_hire: {
      label: t.report.hiringDecision.signals.leaning_no_hire,
      bg: "bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300",
      dot: "bg-amber-500",
    },
    no_hire: {
      label: t.report.hiringDecision.signals.no_hire,
      bg: "bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300",
      dot: "bg-rose-500",
    },
  };
  return configs[signal] ?? configs.hire;
}

function getJobFitRatingBadge(
  rating: ReportJobFitAnalysis["overallFitRating"],
  t: ReturnType<typeof useTranslation>["t"],
) {
  const configs = {
    strong_fit: {
      label: t.interview.fitRatings.strong_fit,
      bg: "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300",
      dot: "bg-emerald-500",
    },
    workable: {
      label: t.interview.fitRatings.workable,
      bg: "bg-blue-500/10 border-blue-500/30 text-blue-700 dark:text-blue-300",
      dot: "bg-blue-500",
    },
    stretch: {
      label: t.interview.fitRatings.stretch,
      bg: "bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300",
      dot: "bg-amber-500",
    },
    gap: {
      label: t.interview.fitRatings.gap,
      bg: "bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300",
      dot: "bg-rose-500",
    },
  };
  return configs[rating] ?? configs.workable;
}

function getSkillEvaluationBadge(
  evaluation: ReportJobFitSkillAssessment["evaluation"],
  t: ReturnType<typeof useTranslation>["t"],
) {
  const configs = {
    exceeded: {
      label: t.interview.evaluations.exceeded,
      bg: "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300",
    },
    satisfied: {
      label: t.interview.evaluations.satisfied,
      bg: "bg-blue-500/10 border-blue-500/30 text-blue-700 dark:text-blue-300",
    },
    partially_met: {
      label: t.interview.evaluations.partially_met,
      bg: "bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300",
    },
    untested: {
      label: t.interview.evaluations.untested,
      bg: "bg-muted/60 border-border text-muted-foreground",
    },
  };
  return configs[evaluation] ?? configs.untested;
}

function getSkillCategoryBadge(
  category: ReportJobFitSkillAssessment["category"],
  t: ReturnType<typeof useTranslation>["t"],
) {
  if (category === "must_have") {
    return {
      label: t.interview.mustHaveSkillsTitle,
      bg: "bg-primary/10 border-primary/25 text-primary",
    };
  }
  return {
    label: t.interview.niceToHaveSkillsTitle,
    bg: "bg-secondary text-secondary-foreground border-border/70",
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

  const overallScoreVal =
    report?.scoreStatus === "scored" && report.overallScore !== null ? report.overallScore : null;
  const grade = overallScoreVal !== null ? getScoreGrade(overallScoreVal, t) : null;

  const isAllExpanded = questions.length > 0 && questions.every((q) => (expandedQuestions[q.id] ?? true) === true);
  const handleToggleAll = () => {
    const nextVal = !isAllExpanded;
    const nextMap: Record<string, boolean> = {};
    questions.forEach((q) => {
      nextMap[q.id] = nextVal;
    });
    setExpandedQuestions(nextMap);
  };

  return (
    <div className="relative min-h-screen bg-background text-foreground selection:bg-primary/20 pb-20">
      {/* Sticky Header */}
      <header className="sticky top-0 z-30 shrink-0 border-b border-border/80 bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/dashboard"
              className="flex shrink-0 items-center gap-2.5 font-semibold tracking-tight transition-opacity hover:opacity-90"
            >
              <BrandIcon size={26} priority />
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
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs shadow-2xs" asChild>
              <Link href={`/interviews/${interviewId}`}>
                <History className="size-3.5" />
                <span>{t.report.reviewInterview}</span>
              </Link>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground hover:text-foreground"
              asChild
            >
              <Link href="/dashboard" aria-label={t.interview.returnDashboard}>
                <ArrowLeft className="size-4" />
              </Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Main Report Body */}
      <main className="mx-auto max-w-5xl space-y-10 px-4 py-8 sm:px-6">
        {/* ============================================================ */}
        {/* SECTION 01: 综合表现与分析总结 (Hero Score & Executive Summary) */}
        {/* ============================================================ */}
        <section className="animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="grid gap-6 lg:grid-cols-12 items-stretch">
            {/* Left: Overall Score Card */}
            <div className="flex flex-col justify-between rounded-2xl border border-border/80 bg-card p-6 shadow-xs lg:col-span-4">
              <div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="font-semibold tracking-wider text-muted-foreground uppercase text-[11px]">
                    {t.report.overallPerformance}
                  </span>
                  {grade ? (
                    <Badge
                      variant="outline"
                      className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${grade.bg} ${grade.color}`}
                    >
                      {grade.label}
                    </Badge>
                  ) : null}
                </div>

                <div className="mt-5 flex items-baseline gap-2">
                  {overallScoreVal !== null ? (
                    <>
                      <span className="text-6xl font-black tracking-tight font-mono tabular-nums text-foreground">
                        {overallScoreVal}
                      </span>
                      <span className="text-xl font-medium text-muted-foreground">/ 100</span>
                    </>
                  ) : (
                    <span className="text-lg font-medium text-muted-foreground">
                      {t.report.noScorableAnswersText}
                    </span>
                  )}
                </div>

                <p className="mt-3 text-xs text-muted-foreground leading-relaxed">
                  {overallScoreVal !== null
                    ? locale === "en"
                      ? `Determined by rigorous weighted 6-dimension evaluation across ${scorableAnswersCount} answers.`
                      : `基于 ${scorableAnswersCount} 道有效回答六维确定性平均加权评定。`
                    : locale === "en"
                      ? "No scorable answers detected (questions were skipped or ended early)."
                      : "本场面试未检测到足够的可评分有效回答（题目被跳过或提前结束）。"}
                </p>
              </div>

              <div className="mt-6 border-t border-border/60 pt-4 grid grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-muted-foreground text-[11px]">
                    {locale === "en" ? "Questions" : "作答考题"}
                  </span>
                  <p className="font-semibold text-foreground mt-0.5 font-mono">
                    {locale === "en"
                      ? `${questions.length} rounds / ${scorableAnswersCount} valid`
                      : `${questions.length} 轮 / ${scorableAnswersCount} 题有效`}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground text-[11px]">{t.report.meta.status}</span>
                  <p className="font-semibold text-emerald-600 dark:text-emerald-400 mt-0.5 flex items-center gap-1">
                    <span className="size-1.5 rounded-full bg-emerald-500 inline-block" />
                    <span>{t.report.statuses.completed}</span>
                  </p>
                </div>
              </div>
            </div>

            {/* Right: Executive Summary & Dual Highlights */}
            <div className="flex flex-col justify-between rounded-2xl border border-border/80 bg-card p-6 shadow-xs lg:col-span-8 space-y-5">
              <div>
                <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                  <Sparkles className="size-4 text-primary" />
                  <span className="tracking-wide uppercase text-[12px]">{t.report.analysisSummary}</span>
                </div>
                <div className="mt-3 text-[14.5px] leading-relaxed text-foreground/90 font-normal">
                  <Markdown content={summary?.overallSummary || t.report.noAnalysisData} />
                </div>
              </div>

              {/* Dual Column: Strengths & Improvements */}
              <div className="grid gap-3.5 sm:grid-cols-2 pt-2 border-t border-border/40">
                {summary?.keyStrengths && summary.keyStrengths.length > 0 ? (
                  <div className="rounded-xl border-l-2 border-emerald-500 bg-emerald-500/5 dark:bg-emerald-950/20 p-3.5 text-xs">
                    <div className="flex items-center gap-1.5 font-semibold text-emerald-800 dark:text-emerald-300">
                      <CheckCircle2 className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                      <span>{t.report.topStrength}</span>
                    </div>
                    <ul className="mt-2 space-y-1.5 text-emerald-950/85 dark:text-emerald-200/85 leading-relaxed">
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
                  <div className="rounded-xl border-l-2 border-amber-500 bg-amber-500/5 dark:bg-amber-950/20 p-3.5 text-xs">
                    <div className="flex items-center gap-1.5 font-semibold text-amber-800 dark:text-amber-300">
                      <TrendingUp className="size-3.5 text-amber-600 dark:text-amber-400" />
                      <span>{t.report.criticalFocus}</span>
                    </div>
                    <ul className="mt-2 space-y-1.5 text-amber-950/85 dark:text-amber-200/85 leading-relaxed">
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
          </div>
        </section>

        {/* ============================================================ */}
        {/* SECTION 02: 招聘委员会决策研判 (Hiring Committee Decision & Trade-offs) */}
        {/* Placed directly beneath Section 01 as requested */}
        {/* ============================================================ */}
        {summary?.hiringDecision ? (
          <section className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="rounded-2xl border border-border/80 bg-card p-6 shadow-xs space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-4">
                <div className="flex items-center gap-2.5">
                  <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Target className="size-4.5" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold tracking-tight text-foreground">
                      {t.report.hiringDecision.title}
                    </h2>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {locale === "en"
                        ? "Synthesized hiring bar evaluation and strategic trade-off analysis"
                        : "综合评估面试表现与团队用人标准后的终审结论"}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2.5">
                  <Badge
                    variant="outline"
                    className={`rounded-full px-3 py-1 text-xs font-semibold gap-1.5 ${
                      getHiringSignalBadge(summary.hiringDecision.signal, t).bg
                    }`}
                  >
                    <span
                      className={`size-1.5 rounded-full ${
                        getHiringSignalBadge(summary.hiringDecision.signal, t).dot
                      }`}
                    />
                    <span>{getHiringSignalBadge(summary.hiringDecision.signal, t).label}</span>
                  </Badge>
                  <Badge
                    variant="outline"
                    className="rounded-full text-[11px] text-muted-foreground border-border/70 font-medium px-2.5 py-0.5"
                  >
                    {t.report.hiringDecision.confidenceLevels[summary.hiringDecision.confidence]}
                  </Badge>
                </div>
              </div>

              {/* Rationale & Trade-offs 2-Column: clean callout blocks with left accent line */}
              <div className="grid gap-4 sm:grid-cols-2 text-xs">
                <div className="space-y-2 rounded-xl bg-muted/25 p-4 border-l-2 border-primary/60">
                  <div className="flex items-center gap-1.5 font-semibold text-foreground text-[13px]">
                    <Award className="size-4 text-primary" />
                    <span>{t.report.hiringDecision.rationale}</span>
                  </div>
                  <p className="text-muted-foreground leading-relaxed text-[13px]">
                    {summary.hiringDecision.decisionRationale}
                  </p>
                </div>

                <div className="space-y-2 rounded-xl bg-muted/25 p-4 border-l-2 border-primary/60">
                  <div className="flex items-center gap-1.5 font-semibold text-foreground text-[13px]">
                    <Compass className="size-4 text-primary" />
                    <span>{t.report.hiringDecision.keyTradeOffs}</span>
                  </div>
                  <p className="text-muted-foreground leading-relaxed text-[13px]">
                    {summary.hiringDecision.keyTradeOffs}
                  </p>
                </div>
              </div>
            </div>
          </section>
        ) : null}

        {/* ============================================================ */}
        {/* SECTION: 岗位契合度与差距诊断 (JD Fit & Gap Analysis) */}
        {/* ============================================================ */}
        {summary?.jobFitAnalysis ? (
          <section className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="rounded-2xl border border-border/80 bg-card p-6 shadow-xs space-y-6">
              {/* Header */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-4">
                <div className="flex items-center gap-2.5">
                  <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Briefcase className="size-4.5" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold tracking-tight text-foreground">
                      {t.interview.jdFitTitle}
                    </h2>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {t.interview.jdFitSubtitle}
                    </p>
                  </div>
                </div>

                <Badge
                  variant="outline"
                  className={`rounded-full px-3 py-1 text-xs font-semibold gap-1.5 ${
                    getJobFitRatingBadge(summary.jobFitAnalysis.overallFitRating, t).bg
                  }`}
                >
                  <span
                    className={`size-1.5 rounded-full ${
                      getJobFitRatingBadge(summary.jobFitAnalysis.overallFitRating, t).dot
                    }`}
                  />
                  <span>{getJobFitRatingBadge(summary.jobFitAnalysis.overallFitRating, t).label}</span>
                </Badge>
              </div>

              {/* Fit Summary Paragraph */}
              <div className="rounded-xl bg-muted/25 p-4 border-l-2 border-primary/60">
                <div className="flex items-center gap-1.5 font-semibold text-foreground text-[13px] mb-1.5">
                  <Sparkles className="size-3.5 text-primary" />
                  <span>{t.interview.fitSummaryTitle}</span>
                </div>
                <p className="text-xs sm:text-[13px] text-muted-foreground leading-relaxed">
                  {summary.jobFitAnalysis.fitSummary}
                </p>
              </div>

              {/* Skills Assessment Grid */}
              {summary.jobFitAnalysis.skillsAssessment &&
              summary.jobFitAnalysis.skillsAssessment.length > 0 ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-foreground uppercase tracking-wider">
                      {t.interview.skillsAssessmentTitle}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {t.interview.competenciesAssessed.replace(
                        "{count}",
                        String(summary.jobFitAnalysis.skillsAssessment.length),
                      )}
                    </span>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    {summary.jobFitAnalysis.skillsAssessment.map((item, idx) => {
                      const catBadge = getSkillCategoryBadge(item.category, t);
                      const evalBadge = getSkillEvaluationBadge(item.evaluation, t);

                      return (
                        <div
                          key={idx}
                          className="flex flex-col justify-between rounded-xl border border-border/70 bg-card/60 p-3.5 shadow-2xs space-y-2 hover:border-primary/40 transition-colors"
                        >
                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-semibold text-xs text-foreground truncate">
                                {item.skillName}
                              </span>
                              <Badge
                                variant="outline"
                                className={`rounded-md px-2 py-0.5 text-[10.5px] font-medium shrink-0 ${evalBadge.bg}`}
                              >
                                {evalBadge.label}
                              </Badge>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <Badge
                                variant="outline"
                                className={`rounded-md px-1.5 py-0 text-[10px] font-normal ${catBadge.bg}`}
                              >
                                {catBadge.label}
                              </Badge>
                            </div>
                          </div>

                          <p className="text-[11.5px] text-muted-foreground leading-relaxed border-t border-border/40 pt-2">
                            {item.evidence}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {/* Dual Highlights: Critical Gaps & Recommended Reverse Questions */}
              <div className="grid gap-4 md:grid-cols-2 pt-2 border-t border-border/40">
                {/* Critical Gaps with Alert Icon */}
                {summary.jobFitAnalysis.criticalGaps &&
                summary.jobFitAnalysis.criticalGaps.length > 0 ? (
                  <div className="rounded-xl border-l-2 border-rose-500 bg-rose-500/5 dark:bg-rose-950/20 p-4 space-y-2.5">
                    <div className="flex items-center gap-1.5 font-semibold text-xs text-rose-800 dark:text-rose-300">
                      <AlertCircle className="size-4 text-rose-600 dark:text-rose-400 shrink-0" />
                      <span>{t.interview.criticalGapsTitle}</span>
                    </div>
                    <ul className="space-y-1.5 text-xs text-rose-950/85 dark:text-rose-200/85 leading-relaxed">
                      {summary.jobFitAnalysis.criticalGaps.map((gap, gIdx) => (
                        <li key={gIdx} className="flex items-start gap-2">
                          <span className="shrink-0 size-1 rounded-full bg-rose-500 mt-1.5" />
                          <span>{gap}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {/* Recommended Reverse Questions with MessageSquare Icon */}
                {summary.jobFitAnalysis.recommendedReverseQuestions &&
                summary.jobFitAnalysis.recommendedReverseQuestions.length > 0 ? (
                  <div className="rounded-xl border-l-2 border-primary bg-primary/5 dark:bg-primary/10 p-4 space-y-2.5">
                    <div className="flex items-center gap-1.5 font-semibold text-xs text-primary">
                      <MessageSquare className="size-4 text-primary shrink-0" />
                      <span>{t.interview.reverseQuestionsTitle}</span>
                    </div>
                    <ul className="space-y-2 text-xs text-foreground/85 leading-relaxed">
                      {summary.jobFitAnalysis.recommendedReverseQuestions.map((q, qIdx) => (
                        <li key={qIdx} className="flex items-start justify-between gap-2 group">
                          <div className="flex items-start gap-2 min-w-0">
                            <span className="shrink-0 size-1 rounded-full bg-primary mt-1.5" />
                            <span>{q}</span>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-6 text-muted-foreground hover:text-foreground opacity-60 group-hover:opacity-100 transition-opacity shrink-0"
                            title={t.interview.copyQuestion}
                            onClick={() => {
                              void navigator.clipboard.writeText(q);
                              toast.success(t.interview.copiedToClipboard);
                            }}
                          >
                            <Copy className="size-3" />
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </div>
          </section>
        ) : null}

        {/* ============================================================ */}
        {/* SECTION 03: 六维胜任力体检矩阵 (6-Dimension Competency Spectrum) */}
        {/* ============================================================ */}
        {averages ? (
          <section className="space-y-4 animate-in fade-in slide-in-from-bottom-3 duration-400">
            <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-2 border-b border-border/60 pb-3">
              <div>
                <h2 className="text-lg font-semibold tracking-tight text-foreground">
                  {t.report.competencyBreakdown}
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">{t.report.competencyDesc}</p>
              </div>
              <Badge
                variant="outline"
                className="self-start sm:self-auto text-[11px] text-muted-foreground font-normal border-border/60"
              >
                {t.report.equalWeightLabel}
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
                    className="flex flex-col justify-between rounded-xl border border-border/80 bg-card p-4.5 shadow-2xs transition-all hover:border-primary/40 hover:shadow-xs"
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-sm text-foreground">{label}</span>
                        <div className="flex items-baseline gap-1 font-mono">
                          <span className="font-bold text-lg text-primary tabular-nums">
                            {score.toFixed(1)}
                          </span>
                          <span className="text-xs text-muted-foreground">/ 10</span>
                        </div>
                      </div>
                      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                        {cfg.description}
                      </p>
                    </div>

                    <div className="mt-4 pt-2">
                      <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1.5 font-medium">
                        <span>{t.report.competencyRating}</span>
                        <span className={dimGrade.color}>{dimGrade.label}</span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/60">
                        <div
                          className="h-full bg-primary/80 transition-all duration-500 ease-out"
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

        {/* ============================================================ */}
        {/* SECTION 04: 独到认知 vs 红队审查 (Strategic Differentiation & Red-Team Audit) */}
        {/* ============================================================ */}
        {summary?.differentiationRating || summary?.redTeamChallenge ? (
          <section className="animate-in fade-in slide-in-from-bottom-4 duration-400">
            <div className="grid gap-6 md:grid-cols-2 items-stretch">
              {/* Left: Differentiation & Earned Secrets */}
              {summary?.differentiationRating ? (
                <div className="flex flex-col justify-between rounded-2xl border border-border/80 bg-card p-5 shadow-xs space-y-4">
                  <div>
                    <div className="flex items-center justify-between gap-2 border-b border-border/60 pb-3">
                      <div className="flex items-center gap-2">
                        <Sparkles className="size-4 text-amber-500" />
                        <h3 className="text-sm font-semibold tracking-tight text-foreground">
                          {t.report.differentiation.title}
                        </h3>
                      </div>
                      <Badge
                        variant="outline"
                        className="rounded-full text-[11px] font-medium border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                      >
                        {t.report.differentiation.levels[summary.differentiationRating.level]}
                      </Badge>
                    </div>

                    <p className="mt-3 text-xs text-muted-foreground leading-relaxed">
                      {summary.differentiationRating.summary}
                    </p>
                  </div>

                  {summary.differentiationRating.earnedSecrets &&
                  summary.differentiationRating.earnedSecrets.length > 0 ? (
                    <div className="border-t border-border/60 pt-3 space-y-2">
                      <span className="text-[11px] font-semibold text-foreground uppercase tracking-wider">
                        {t.report.differentiation.earnedSecrets}
                      </span>
                      <ul className="space-y-1.5 text-xs text-muted-foreground">
                        {summary.differentiationRating.earnedSecrets.map((secret, idx) => (
                          <li key={idx} className="flex items-start gap-2">
                            <span className="shrink-0 size-1 rounded-full bg-amber-500 mt-1.5" />
                            <span className="text-foreground/90">{secret}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {/* Right: Red-Team Challenge & Blind Spots */}
              {summary?.redTeamChallenge ? (
                <div className="flex flex-col justify-between rounded-2xl border border-amber-500/20 bg-amber-500/5 dark:bg-amber-950/15 p-5 shadow-xs space-y-4">
                  <div>
                    <div className="flex items-center gap-2 border-b border-amber-500/20 pb-3">
                      <ShieldAlert className="size-4 text-amber-600 dark:text-amber-400" />
                      <h3 className="text-sm font-semibold tracking-tight text-amber-950 dark:text-amber-200">
                        {t.report.redTeam.title}
                      </h3>
                    </div>

                    {summary.redTeamChallenge.hiddenAssumptions &&
                    summary.redTeamChallenge.hiddenAssumptions.length > 0 ? (
                      <div className="mt-3 space-y-1.5">
                        <span className="text-[11px] font-semibold text-amber-900 dark:text-amber-300">
                          {t.report.redTeam.hiddenAssumptions}
                        </span>
                        <ul className="space-y-1 text-xs text-amber-950/80 dark:text-amber-200/80 leading-relaxed">
                          {summary.redTeamChallenge.hiddenAssumptions.map((item, idx) => (
                            <li key={idx} className="flex items-start gap-1.5">
                              <span className="shrink-0 size-1 rounded-full bg-amber-500 mt-1.5" />
                              <span>{item}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    {summary.redTeamChallenge.blindSpots &&
                    summary.redTeamChallenge.blindSpots.length > 0 ? (
                      <div className="mt-3 space-y-1.5">
                        <span className="text-[11px] font-semibold text-amber-900 dark:text-amber-300">
                          {t.report.redTeam.blindSpots}
                        </span>
                        <ul className="space-y-1 text-xs text-amber-950/80 dark:text-amber-200/80 leading-relaxed">
                          {summary.redTeamChallenge.blindSpots.map((item, idx) => (
                            <li key={idx} className="flex items-start gap-1.5">
                              <span className="shrink-0 size-1 rounded-full bg-amber-500 mt-1.5" />
                              <span>{item}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>

                  {summary.redTeamChallenge.devilsAdvocateRejectionReason ? (
                    <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-xs">
                      <span className="font-semibold text-rose-800 dark:text-rose-300">
                        {t.report.redTeam.devilsAdvocate}
                      </span>
                      <p className="mt-1 text-rose-950/85 dark:text-rose-200/85 leading-relaxed">
                        {summary.redTeamChallenge.devilsAdvocateRejectionReason}
                      </p>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        {/* ============================================================ */}
        {/* SECTION 05: 72小时黄金突破指南与战略建议 (72h Action Plan & Strategic Roadmap) */}
        {/* ============================================================ */}
        {summary?.priorityActionPlan72h || summary?.recommendations ? (
          <section className="animate-in fade-in slide-in-from-bottom-5 duration-500">
            <div className="rounded-2xl border border-primary/20 bg-card p-6 shadow-xs space-y-6">
              {/* 3 Progressive Action Steps */}
              {summary?.priorityActionPlan72h ? (
                <div>
                  <div className="flex items-center gap-2 text-xs font-semibold text-primary uppercase tracking-wider mb-4">
                    <Clock className="size-4" />
                    <span>{t.report.actionPlan72h.title}</span>
                  </div>

                  <div className="grid gap-4 md:grid-cols-3 text-xs">
                    <div className="rounded-xl border border-border/70 bg-muted/20 p-4 space-y-2 transition-colors hover:border-primary/40">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 font-semibold text-foreground">
                          <Clock className="size-3.5 text-primary" />
                          <span>{t.report.actionPlan72h.immediate24h}</span>
                        </div>
                        <span className="font-mono text-[10px] text-primary/70 font-semibold px-1.5 py-0.5 rounded bg-primary/10">
                          STEP 01
                        </span>
                      </div>
                      <p className="text-muted-foreground leading-relaxed text-[12.5px]">
                        {summary.priorityActionPlan72h.immediate24h}
                      </p>
                    </div>

                    <div className="rounded-xl border border-border/70 bg-muted/20 p-4 space-y-2 transition-colors hover:border-primary/40">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 font-semibold text-foreground">
                          <Compass className="size-3.5 text-primary" />
                          <span>{t.report.actionPlan72h.storybankAdjust48h}</span>
                        </div>
                        <span className="font-mono text-[10px] text-primary/70 font-semibold px-1.5 py-0.5 rounded bg-primary/10">
                          STEP 02
                        </span>
                      </div>
                      <p className="text-muted-foreground leading-relaxed text-[12.5px]">
                        {summary.priorityActionPlan72h.storybankAdjust48h}
                      </p>
                    </div>

                    <div className="rounded-xl border border-border/70 bg-muted/20 p-4 space-y-2 transition-colors hover:border-primary/40">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 font-semibold text-foreground">
                          <Target className="size-3.5 text-primary" />
                          <span>{t.report.actionPlan72h.targetedDrill72h}</span>
                        </div>
                        <span className="font-mono text-[10px] text-primary/70 font-semibold px-1.5 py-0.5 rounded bg-primary/10">
                          STEP 03
                        </span>
                      </div>
                      <p className="text-muted-foreground leading-relaxed text-[12.5px]">
                        {summary.priorityActionPlan72h.targetedDrill72h}
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}

              {/* Strategic Recommendations */}
              {summary?.recommendations ? (
                <div className="border-t border-border/60 pt-5 space-y-3">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-foreground">
                    <Compass className="size-4 text-primary" />
                    <span>{t.report.recommendationsTitle}</span>
                  </div>
                  <div className="text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
                    <Markdown content={summary.recommendations} />
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 pt-3">
                    <span className="text-[11px] text-muted-foreground">{t.report.recommendationTip}</span>
                    <Button size="sm" className="gap-1.5 font-medium shadow-xs" asChild>
                      <Link href="/dashboard">
                        <RotateCcw className="size-3.5" />
                        <span>{t.report.startNewSession}</span>
                      </Link>
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        {/* ============================================================ */}
        {/* SECTION 06: 面试官内心真实透视流 (Interviewer Psychological Journey) */}
        {/* ============================================================ */}
        {summary?.innerMonologues && summary.innerMonologues.length > 0 ? (
          <section className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="border-b border-border/60 pb-3">
              <h2 className="text-lg font-semibold tracking-tight text-foreground flex items-center gap-2">
                <MessageSquareQuote className="size-5 text-primary" />
                <span>{t.report.innerMonologue.title}</span>
              </h2>
              <p className="text-xs text-muted-foreground mt-1">
                {t.report.innerMonologue.description}
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {summary.innerMonologues.map((item, idx) => (
                <div
                  key={idx}
                  className="flex flex-col justify-between rounded-xl border border-primary/20 bg-primary/5 dark:bg-primary/10 p-4 shadow-2xs transition-all hover:border-primary/40 hover:shadow-xs space-y-3"
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Badge
                        variant="outline"
                        className="rounded-md px-2 py-0.5 text-[11px] font-mono border-primary/30 text-primary"
                      >
                        {locale === "en"
                          ? `Q${item.questionSequence} · ${item.topic}`
                          : `第 ${item.questionSequence} 题 · ${item.topic}`}
                      </Badge>
                    </div>
                    <div className="text-xs italic text-muted-foreground/90 border-l-2 border-primary/40 pl-2.5 py-0.5">
                      &ldquo;{item.triggerQuote}&rdquo;
                    </div>
                    <p className="text-xs leading-relaxed text-foreground/90 pt-1">
                      {item.monologue}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {/* ============================================================ */}
        {/* SECTION 07: 逐题深度复盘证据卷宗 (Question-by-Question Detailed Dossier) */}
        {/* ============================================================ */}
        <section className="space-y-4 animate-in fade-in slide-in-from-bottom-5 duration-500">
          <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-3 border-b border-border/60 pb-3">
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-foreground">
                {t.report.detailedAnalysis}
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t.report.detailedAnalysisSubtitle}
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <span className="text-xs text-muted-foreground">
                {locale === "en" ? `${questions.length} questions` : `共 ${questions.length} 道考题`}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleToggleAll}
                className="h-7 text-xs text-muted-foreground hover:text-foreground px-2 gap-1"
              >
                {isAllExpanded ? (
                  <>
                    <ChevronUp className="size-3.5" />
                    <span>{locale === "en" ? "Collapse All" : "收起全部"}</span>
                  </>
                ) : (
                  <>
                    <ChevronDown className="size-3.5" />
                    <span>{locale === "en" ? "Expand All" : "展开全部"}</span>
                  </>
                )}
              </Button>
            </div>
          </div>

          <div className="space-y-4 pt-1">
            {questions.map((q) => {
              const isExpanded = expandedQuestions[q.id] ?? true;
              const isSkipped = q.status === "skipped" || q.answerStatus === "skipped";

              return (
                <div
                  key={q.id}
                  className="rounded-2xl border border-border/80 bg-card shadow-2xs transition-all hover:border-border overflow-hidden"
                >
                  {/* Card Trigger Header */}
                  <button
                    type="button"
                    onClick={() => toggleQuestion(q.id)}
                    className="flex w-full cursor-pointer items-start justify-between gap-4 p-4 text-left transition-colors hover:bg-muted/30 sm:p-5"
                  >
                    <div className="space-y-2 min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          variant="outline"
                          className="rounded-md px-2 py-0.5 text-[11px] font-medium font-mono"
                        >
                          {locale === "en" ? `Q${q.sequence}` : `第 ${q.sequence} 题`}
                        </Badge>
                        {q.topic ? (
                          <Badge
                            variant="secondary"
                            className="rounded-md border border-primary/20 bg-primary/5 px-2 py-0.5 text-[11px] font-medium text-primary"
                          >
                            {q.topic}
                          </Badge>
                        ) : null}
                        {q.feedback?.rootCause &&
                        q.feedback.rootCause !== "none" &&
                        t.report.rootCauses[q.feedback.rootCause] ? (
                          <Badge
                            variant="outline"
                            className="rounded-md border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300"
                          >
                            {t.report.rootCauses[q.feedback.rootCause]}
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
                            {t.report.score}: {q.overall.toFixed(1)} / 10
                          </Badge>
                        ) : null}
                      </div>

                      <div className="text-[14.5px] font-medium leading-relaxed text-foreground/95 pt-0.5">
                        <Markdown content={q.question} />
                      </div>
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
                      <div className="border-t border-border/60 bg-muted/10 p-5 sm:p-6 space-y-6 text-sm">
                        {/* 1. Candidate Answer (Editorial transcript look, no box-in-box) */}
                        <div className="space-y-2">
                          <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                            <UserRound className="size-3.5" />
                            <span>{t.report.yourAnswer}</span>
                          </div>
                          <div className="border-l-2 border-primary/40 pl-4 py-1 text-xs sm:text-[13px] leading-relaxed text-foreground/90 [overflow-wrap:anywhere]">
                            {isSkipped ? (
                              <span className="text-xs text-muted-foreground italic">
                                {t.interview.skippedAnswer}
                              </span>
                            ) : q.answer ? (
                              <Markdown content={q.answer} />
                            ) : (
                              <span className="text-xs text-muted-foreground">
                                {t.report.noAnswerRecordText}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* 2. Interviewer Reaction Quote (if present) */}
                        {q.feedback?.interviewerReaction ? (
                          <div className="border-l-2 border-amber-500/60 bg-amber-500/5 dark:bg-amber-950/20 rounded-r-xl p-3.5 space-y-1">
                            <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-800 dark:text-amber-300">
                              <MessageSquareQuote className="size-3.5 text-amber-600 dark:text-amber-400" />
                              <span>{t.report.interviewerReactionTitle}</span>
                            </div>
                            <p className="text-xs sm:text-[12.5px] text-foreground/90 leading-relaxed italic">
                              &ldquo;{q.feedback.interviewerReaction}&rdquo;
                            </p>
                          </div>
                        ) : null}

                        {/* 3. 6-Dimension Score Ribbon (Compact inline metrics) */}
                        {q.scores ? (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground">
                              <span className="uppercase tracking-wider text-[11px]">
                                {t.report.scoreBreakdownTitle}
                              </span>
                              <span className="font-normal text-[11px] text-muted-foreground">
                                {t.report.maxScoreLabel}
                              </span>
                            </div>
                            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                              {(
                                Object.keys(DIMENSION_CONFIG) as Array<keyof ReportDimensionAverages>
                              ).map((dimKey) => {
                                const dimScore = q.scores?.[dimKey] ?? 0;
                                const cfg = DIMENSION_CONFIG[dimKey];
                                const label = locale === "en" ? cfg.labelEn : cfg.labelZh;

                                return (
                                  <div
                                    key={dimKey}
                                    className="rounded-lg border border-border/70 bg-card/80 px-2.5 py-2 text-center"
                                  >
                                    <div className="text-[11px] text-muted-foreground truncate">
                                      {label}
                                    </div>
                                    <div className="font-bold text-sm font-mono text-primary mt-0.5 tabular-nums">
                                      {dimScore}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ) : null}

                        {/* 4. Feedback Tri-Column (Strengths, Improvements, Advice) */}
                        {q.feedback ? (
                          <div className="grid gap-3.5 pt-1 md:grid-cols-3">
                            {/* Strengths */}
                            {q.feedback.strengths && q.feedback.strengths.length > 0 ? (
                              <div className="rounded-xl border-l-2 border-emerald-500 bg-emerald-500/5 dark:bg-emerald-950/20 p-3.5">
                                <div className="flex items-center gap-1.5 font-semibold text-xs text-emerald-800 dark:text-emerald-300">
                                  <CheckCircle2 className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                                  <span>{t.report.strengths}</span>
                                </div>
                                <ul className="mt-2 space-y-1.5 text-xs text-emerald-950/85 dark:text-emerald-200/85 leading-relaxed">
                                  {q.feedback.strengths.map((s, idx) => (
                                    <li key={idx} className="flex items-start gap-1.5">
                                      <span className="shrink-0 size-1 rounded-full bg-emerald-500 mt-1.5" />
                                      <span>{s}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            ) : null}

                            {/* Improvements */}
                            {q.feedback.improvements && q.feedback.improvements.length > 0 ? (
                              <div className="rounded-xl border-l-2 border-amber-500 bg-amber-500/5 dark:bg-amber-950/20 p-3.5">
                                <div className="flex items-center gap-1.5 font-semibold text-xs text-amber-800 dark:text-amber-300">
                                  <TrendingUp className="size-3.5 text-amber-600 dark:text-amber-400" />
                                  <span>{t.report.improvements}</span>
                                </div>
                                <ul className="mt-2 space-y-1.5 text-xs text-amber-950/85 dark:text-amber-200/85 leading-relaxed">
                                  {q.feedback.improvements.map((imp, idx) => (
                                    <li key={idx} className="flex items-start gap-1.5">
                                      <span className="shrink-0 size-1 rounded-full bg-amber-500 mt-1.5" />
                                      <span>{imp}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            ) : null}

                            {/* Advice */}
                            {q.feedback.advice ? (
                              <div className="rounded-xl border-l-2 border-primary/60 bg-primary/5 dark:bg-primary/10 p-3.5">
                                <div className="flex items-center gap-1.5 font-semibold text-xs text-primary">
                                  <Lightbulb className="size-3.5" />
                                  <span>{t.report.advice}</span>
                                </div>
                                <div className="mt-2 text-xs text-foreground/85 leading-relaxed [overflow-wrap:anywhere]">
                                  <Markdown content={q.feedback.advice} />
                                </div>
                              </div>
                            ) : null}
                          </div>
                        ) : null}

                        {/* 5. High-Scoring Rewrite Model & Annotations */}
                        {q.feedback?.rewriteExample ? (
                          <div className="rounded-xl border border-primary/20 bg-primary/[0.03] dark:bg-primary/5 p-4.5 space-y-3">
                            <div className="flex items-center gap-1.5 text-xs font-semibold text-primary">
                              <Sparkles className="size-3.5 text-primary" />
                              <span>{t.report.rewrite.title}</span>
                            </div>

                            <div className="rounded-lg border border-border/60 bg-background p-3.5 text-xs sm:text-[13px] leading-relaxed text-foreground/90 font-normal [overflow-wrap:anywhere]">
                              <Markdown content={q.feedback.rewriteExample.improvedExcerpt} />
                            </div>

                            {q.feedback.rewriteExample.annotations &&
                            q.feedback.rewriteExample.annotations.length > 0 ? (
                              <div className="space-y-1.5 text-xs pt-1">
                                <span className="font-semibold text-foreground/80 text-[11px] uppercase tracking-wider">
                                  {t.report.rewrite.annotations}
                                </span>
                                <ul className="space-y-1.5 text-muted-foreground">
                                  {q.feedback.rewriteExample.annotations.map((ann, aIdx) => (
                                    <li key={aIdx} className="flex items-start gap-2">
                                      <span className="shrink-0 size-1 rounded-full bg-primary mt-1.5" />
                                      <span className="text-foreground/85">{ann}</span>
                                    </li>
                                  ))}
                                </ul>
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
      </main>
    </div>
  );
}
