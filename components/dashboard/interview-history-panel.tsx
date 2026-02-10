"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Clock3,
  History,
} from "lucide-react";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import type {
  ResumeVersion,
  VersionInterview,
} from "@/components/dashboard/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

interface InterviewHistoryPanelProps {
  selectedResumeTitle?: string;
  selectedVersion: ResumeVersion | null;
}

function formatDurationLabel(
  interview: VersionInterview,
  hourMinuteTemplate: string,
  minuteTemplate: string,
) {
  const startedAt = new Date(interview.createdAt);
  const endedAt = interview.completedAt
    ? new Date(interview.completedAt)
    : new Date();
  const diffMs = endedAt.getTime() - startedAt.getTime();

  if (!Number.isFinite(diffMs)) {
    return "--";
  }

  const totalMinutes = Math.max(1, Math.round(diffMs / 60000));
  if (totalMinutes < 60) {
    return minuteTemplate.replace("{minutes}", String(totalMinutes));
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hourMinuteTemplate
    .replace("{hours}", String(hours))
    .replace("{minutes}", String(minutes));
}

export function InterviewHistoryPanel({
  selectedResumeTitle,
  selectedVersion,
}: InterviewHistoryPanelProps) {
  const { locale, t } = useTranslation();
  const [openStateByVersionId, setOpenStateByVersionId] = useState<
    Record<string, boolean>
  >({});
  const interviews = selectedVersion?.interviews ?? [];
  const hasInterviews = interviews.length > 0;
  const versionStateKey = selectedVersion?.id ?? "__none__";
  const isOpen = openStateByVersionId[versionStateKey] ?? hasInterviews;

  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      }),
    [locale],
  );

  const getTypeLabel = (value: string) => {
    const labels: Record<string, string> = {
      behavioral: t.interview.behavioral,
      technical: t.interview.technical,
      mixed: t.interview.mixed,
    };
    return labels[value] ?? value;
  };

  const getLevelLabel = (value: string) => {
    const labels: Record<string, string> = {
      junior: t.interview.levels.Junior,
      mid: t.interview.levels.Mid,
      senior: t.interview.levels.Senior,
    };
    return labels[value.toLowerCase()] ?? value;
  };

  const getDateLabel = (value: string) => {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) {
      return "--";
    }
    return dateFormatter.format(date);
  };

  const getScoreBadge = (score: number) => {
    if (score >= 85) {
      return {
        label: t.report.strongPerformer,
        className:
          "bg-emerald-100/80 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
      };
    }
    if (score >= 70) {
      return {
        label: t.report.goodProgress,
        className:
          "bg-yellow-100/80 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300",
      };
    }
    return {
      label: t.report.needsImprovement,
      className:
        "bg-rose-100/80 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300",
    };
  };

  const togglePanel = () => {
    setOpenStateByVersionId((prev) => {
      const currentOpen = prev[versionStateKey] ?? hasInterviews;
      return {
        ...prev,
        [versionStateKey]: !currentOpen,
      };
    });
  };

  return (
    <aside
      className={cn(
        "flex min-h-0 shrink-0 border-l bg-card transition-[width] duration-300 ease-out",
        isOpen ? "w-[340px]" : "w-14",
      )}
    >
      {isOpen ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <History className="size-4 shrink-0 text-muted-foreground" />
              <h2 className="truncate text-sm font-semibold">
                {t.dashboard.interviewHistory}
              </h2>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="shrink-0"
              aria-label={t.interview.collapseTip}
              onClick={togglePanel}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>

          <ScrollArea className="min-h-0 flex-1">
            {interviews.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <Clock3 className="mx-auto size-9 text-muted-foreground/35" />
                <p className="mt-3 text-sm text-muted-foreground">
                  {t.dashboard.noInterviews}
                </p>
              </div>
            ) : (
              <div className="space-y-3 p-3">
                {interviews.map((interview) => {
                  const isCompleted = interview.status === "completed";
                  const href = isCompleted
                    ? `/interviews/${interview.id}/report`
                    : `/interviews/${interview.id}/room`;
                  const score = interview.overallScore;
                  const scoreToneClass =
                    score != null && score >= 85
                      ? "text-emerald-600"
                      : score != null && score >= 70
                        ? "text-blue-600"
                        : "text-amber-600";
                  const scoreBadge =
                    score != null ? getScoreBadge(score) : null;
                  const metaLabel = `${getLevelLabel(interview.level)} · ${interview.questionCount} ${t.report.questions}`;

                  return (
                    <article
                      key={interview.id}
                      className="group rounded-xl border border-slate-200/80 bg-white/90 p-3.5 shadow-sm transition-all hover:border-primary/30 hover:shadow-md dark:border-slate-800 dark:bg-slate-950/40"
                    >
                      <div className="mb-3 flex items-start justify-between gap-3">
                        <div>
                          <p className="mb-1 text-xs text-slate-500 dark:text-slate-400">
                            {getDateLabel(interview.createdAt)}
                          </p>
                          <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
                            {getTypeLabel(interview.type)}
                          </h4>
                          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                            {metaLabel}
                          </p>
                        </div>

                        {isCompleted && score != null && scoreBadge ? (
                          <div className="flex flex-col items-end">
                            <span
                              className={cn(
                                "text-sm font-bold",
                                scoreToneClass,
                              )}
                            >
                              {score}
                              <span className="text-[10px] font-normal text-slate-400">
                                /100
                              </span>
                            </span>
                            <span
                              className={cn(
                                "mt-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                                scoreBadge.className,
                              )}
                            >
                              {scoreBadge.label}
                            </span>
                          </div>
                        ) : (
                          <Badge variant="outline" className="shrink-0">
                            {t.report.statuses.active}
                          </Badge>
                        )}
                      </div>

                      <div className="flex items-center justify-between border-t border-slate-100 pt-3 dark:border-slate-800">
                        <span className="text-[11px] text-slate-400">
                          {formatDurationLabel(
                            interview,
                            t.interview.completionDurationHoursMinutes,
                            t.interview.completionDurationMinutes,
                          )}
                        </span>
                        <Link
                          href={href}
                          className="inline-flex items-center gap-1 text-xs font-medium text-primary transition-all group-hover:gap-2 hover:underline"
                        >
                          {isCompleted
                            ? t.interview.viewReport
                            : t.interview.session}
                          <ArrowRight className="size-3.5" />
                        </Link>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </div>
      ) : (
        <div className="flex w-full flex-col items-center border-l py-3">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t.interview.expandTip}
            onClick={togglePanel}
          >
            <ChevronLeft className="size-4" />
          </Button>
        </div>
      )}
    </aside>
  );
}
