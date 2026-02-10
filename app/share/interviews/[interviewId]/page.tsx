"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { BrandIcon } from "@/components/brand/brand-icon";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n/context";
import { ReportOverviewGrid } from "@/components/interview/report/report-overview-grid";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

type ReportDimensionKey =
  | "understanding"
  | "expression"
  | "logic"
  | "depth"
  | "authenticity"
  | "reflection";

interface ReportDimensionItem {
  name: string;
  score: number;
}

type ReportDimensions =
  | Partial<Record<ReportDimensionKey, number>>
  | ReportDimensionItem[];

interface ReportJson {
  overallScore: number;
  dimensions: ReportDimensions;
  topStrengths: string[];
  criticalFocus: string[];
  summary: string;
}

interface QuestionScore {
  understanding: number;
  expression: number;
  logic: number;
  depth: number;
  authenticity: number;
  reflection: number;
  overall: number;
}

interface QuestionFeedback {
  strengths?: string[];
  improvements?: string[];
  advice?: string[];
}

interface QuestionData {
  id: string;
  questionIndex: number;
  questionType: string;
  topic: string | null;
  question: string;
  answerText: string | null;
  score: QuestionScore | null;
  feedbackJson?: QuestionFeedback | null;
}

interface InterviewData {
  id: string;
  level: string;
  type: string;
  status: string;
  overallScore: number | null;
  reportJson: ReportJson | null;
  sharedByName: string | null;
}

interface PublicInterviewApiResponse {
  interview: InterviewData;
  questions: QuestionData[];
}

const radarDimensionOrder: ReportDimensionKey[] = [
  "understanding",
  "expression",
  "logic",
  "depth",
  "authenticity",
  "reflection",
];

function normalizeRadarScore(score: unknown) {
  if (typeof score !== "number" || Number.isNaN(score)) return 0.5;
  const normalized = score > 10 ? score / 100 : score / 10;
  return Math.max(0, Math.min(1, normalized));
}

function buildRadarValues(dimensions: ReportDimensions | undefined) {
  if (!dimensions) return [0.5, 0.5, 0.5, 0.5, 0.5, 0.5];

  if (Array.isArray(dimensions)) {
    return radarDimensionOrder.map((key) => {
      const dim = dimensions.find((d) => d.name?.toLowerCase() === key);
      return normalizeRadarScore(dim?.score);
    });
  }

  return radarDimensionOrder.map((key) => normalizeRadarScore(dimensions[key]));
}

function getScoreColor(score: number) {
  if (score >= 8)
    return "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300";
  if (score >= 5)
    return "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300";
  return "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300";
}

function getTypeColor(type: string) {
  if (type?.toLowerCase().includes("behavioral"))
    return "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300";
  if (type?.toLowerCase().includes("system"))
    return "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300";
  return "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300";
}

export default function SharedInterviewReportPage() {
  const { t } = useTranslation();
  const params = useParams<{ interviewId: string }>();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const interviewId = params.interviewId;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PublicInterviewApiResponse | null>(null);

  useEffect(() => {
    if (!token) return;

    fetch(`/api/public/interviews/${interviewId}?token=${encodeURIComponent(token)}`)
      .then(async (response) => {
        if (!response.ok) {
          if (response.status === 401) {
            throw new Error(t.report.shareInvalidLink);
          }
          throw new Error(t.report.shareLoadFailed);
        }
        return response.json();
      })
      .then((payload) => {
        setData(payload);
        setError(null);
      })
      .catch((fetchError: unknown) => {
        setError(
          fetchError instanceof Error ? fetchError.message : t.report.shareLoadFailed,
        );
      })
      .finally(() => {
        setLoading(false);
      });
  }, [interviewId, token, t.report.shareInvalidLink, t.report.shareLoadFailed]);

  if (!token) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="max-w-md w-full rounded-2xl border bg-card p-6 text-center space-y-4">
          <div className="mx-auto flex size-10 items-center justify-center rounded-full bg-amber-100">
            <AlertCircle className="size-5 text-amber-600" />
          </div>
          <p className="text-sm text-foreground">{t.report.shareInvalidLink}</p>
          <Link href="/" className="text-sm text-primary hover:underline">
            {t.deepDive.home}
          </Link>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="max-w-md w-full rounded-2xl border bg-card p-6 text-center space-y-4">
          <div className="mx-auto flex size-10 items-center justify-center rounded-full bg-amber-100">
            <AlertCircle className="size-5 text-amber-600" />
          </div>
          <p className="text-sm text-foreground">{error || t.report.shareLoadFailed}</p>
          <Link href="/" className="text-sm text-primary hover:underline">
            {t.deepDive.home}
          </Link>
        </div>
      </div>
    );
  }

  const interview = data.interview;
  const questions = data.questions;
  const report = interview.reportJson;
  const overallScore = interview.overallScore ?? 0;
  const radarValues = buildRadarValues(report?.dimensions);
  const topStrengths =
    report && Array.isArray(report.topStrengths) ? report.topStrengths : [];
  const criticalFocus =
    report && Array.isArray(report.criticalFocus) ? report.criticalFocus : [];

  const levelLabels: Record<string, string> = {
    junior: t.interview.levels.Junior,
    mid: t.interview.levels.Mid,
    senior: t.interview.levels.Senior,
  };
  const interviewTypeLabels: Record<string, string> = {
    behavioral: t.interview.behavioral,
    technical: t.interview.technical,
    mixed: t.interview.mixed,
  };
  const interviewStatusLabels: Record<string, string> = {
    active: t.report.statuses.active,
    completed: t.report.statuses.completed,
  };
  const levelLabel = interview.level
    ? (levelLabels[interview.level.toLowerCase()] ?? interview.level)
    : "--";
  const interviewTypeLabel = interview.type
    ? (interviewTypeLabels[interview.type.toLowerCase()] ?? interview.type)
    : "--";
  const interviewStatus = interview.status?.toLowerCase() ?? "completed";
  const interviewStatusLabel =
    interviewStatusLabels[interviewStatus] ??
    interview.status ??
    t.report.statuses.completed;
  const sharedByName = interview.sharedByName?.trim() || t.report.sharedByUnknown;

  const radarLabelNames = [
    t.report.radarLabels.understanding,
    t.report.radarLabels.expression,
    t.report.radarLabels.logic,
    t.report.radarLabels.depth,
    t.report.radarLabels.authenticity,
    t.report.radarLabels.reflection,
  ];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="sticky top-0 z-40 bg-card border-b">
        <div className="max-w-[1200px] mx-auto flex items-center justify-between px-4 sm:px-8 h-16">
          <Link
            href="/"
            className="flex items-center gap-2 text-xl font-bold tracking-tight"
          >
            <BrandIcon size={28} />
            <span>Seconda</span>
          </Link>
          <Badge className="border-0 bg-primary/10 text-primary">
            {t.report.sharedReport}
          </Badge>
        </div>
      </header>

      <main className="flex-1 max-w-[1200px] w-full mx-auto py-8 px-4 sm:px-8">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-2xl font-bold tracking-tight">{t.report.title}</h1>
            <Badge
              className={cn(
                "border-0",
                interviewStatus === "completed"
                  ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
                  : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
              )}
            >
              {interviewStatusLabel}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {t.report.meta.interviewType}: {interviewTypeLabel} &bull;{" "}
            {t.report.meta.targetLevel}: {levelLabel} &bull;{" "}
            {t.report.sharedBy}: {sharedByName} &bull;{" "}
            {questions.length} {t.report.questions}
          </p>
        </div>

        <ReportOverviewGrid
          overallScore={overallScore}
          radarValues={radarValues}
          radarLabelNames={radarLabelNames}
          topStrengths={topStrengths}
          criticalFocus={criticalFocus}
          labels={{
            overallPerformance: t.report.overallPerformance,
            competencyBreakdown: t.report.competencyBreakdown,
            analysisSummary: t.report.analysisSummary,
            topStrength: t.report.topStrength,
            criticalFocus: t.report.criticalFocus,
            noAnalysisData: t.report.noAnalysisData,
            score: t.report.score,
            strongPerformer: t.report.strongPerformer,
            goodProgress: t.report.goodProgress,
            needsImprovement: t.report.needsImprovement,
          }}
        />

        <div className="mb-4">
          <h2 className="text-lg font-semibold">{t.report.detailedAnalysis}</h2>
        </div>

        <Accordion
          type="single"
          defaultValue={questions[0]?.id}
          collapsible
          className="space-y-4"
        >
          {questions.map((question) => {
            const score = question.score?.overall ?? 0;
            const feedback = question.feedbackJson || {};
            const strengths = feedback.strengths || [];
            const improvements = feedback.improvements || [];
            const advice = feedback.advice || [];

            return (
              <AccordionItem
                key={question.id}
                value={question.id}
                className="border rounded-xl bg-card shadow-sm overflow-hidden"
              >
                <AccordionTrigger className="px-6 py-5 hover:no-underline">
                  <div className="flex flex-col gap-2 text-left w-full">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge
                        className={cn(
                          "border-0 text-xs",
                          getTypeColor(question.questionType),
                        )}
                      >
                        Q{question.questionIndex}
                      </Badge>
                      <Badge
                        className={cn("border-0 text-xs", getScoreColor(score))}
                      >
                        {t.report.score}: {score}/10
                      </Badge>
                    </div>
                    <p className="font-medium text-sm leading-snug">
                      {question.question}
                    </p>
                    {question.answerText && (
                      <p className="text-sm text-muted-foreground line-clamp-1">
                        {question.answerText}
                      </p>
                    )}
                    {score >= 8 && (
                      <div className="flex items-center gap-1.5 text-green-600 text-xs font-medium">
                        <CheckCircle2 className="size-3.5" />
                        {t.report.strongAnswer}
                      </div>
                    )}
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-6">
                  <div className="space-y-5">
                    {question.answerText && (
                      <div>
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                          {t.report.yourAnswer}
                        </h4>
                        <div className="bg-muted/50 rounded-lg p-4">
                          <p className="text-sm italic text-muted-foreground leading-relaxed">
                            &ldquo;{question.answerText}&rdquo;
                          </p>
                        </div>
                      </div>
                    )}

                    {(strengths.length > 0 ||
                      improvements.length > 0 ||
                      advice.length > 0) && (
                      <div>
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                          {t.report.aiFeedback}
                        </h4>
                        <div className="bg-primary/5 rounded-lg p-4">
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            {strengths.length > 0 && (
                              <div>
                                <p className="text-xs font-semibold text-green-600 mb-2">
                                  {t.report.strengths}
                                </p>
                                <ul className="space-y-1.5">
                                  {strengths.map((item, index) => (
                                    <li
                                      key={`${question.id}-strength-${index}`}
                                      className="text-sm text-foreground leading-snug"
                                    >
                                      {item}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {improvements.length > 0 && (
                              <div>
                                <p className="text-xs font-semibold text-orange-600 mb-2">
                                  {t.report.improvements}
                                </p>
                                <ul className="space-y-1.5">
                                  {improvements.map((item, index) => (
                                    <li
                                      key={`${question.id}-improvement-${index}`}
                                      className="text-sm text-foreground leading-snug"
                                    >
                                      {item}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {advice.length > 0 && (
                              <div>
                                <p className="text-xs font-semibold text-blue-600 mb-2">
                                  {t.report.advice}
                                </p>
                                <ul className="space-y-1.5">
                                  {advice.map((item, index) => (
                                    <li
                                      key={`${question.id}-advice-${index}`}
                                      className="text-sm text-foreground leading-snug"
                                    >
                                      {item}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      </main>
    </div>
  );
}
