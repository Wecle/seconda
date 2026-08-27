"use client";

import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  Award,
  CheckCircle2,
  Clock,
  FileBarChart2,
  History,
  Loader2,
  RotateCcw,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useTranslation } from "@/lib/i18n/context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { InterviewSummaryItem } from "@/components/dashboard/types";
import { cn } from "@/lib/utils";

interface InterviewCardProps {
  interview: InterviewSummaryItem;
  showVersionBadge?: boolean;
  onDeleteClick: (interview: InterviewSummaryItem) => void;
  deleting?: boolean;
}

export function InterviewCard({
  interview,
  showVersionBadge = false,
  onDeleteClick,
  deleting = false,
}: InterviewCardProps) {
  const { t, locale } = useTranslation();

  const formattedDate = (() => {
    const raw = interview.startedAt || interview.createdAt;
    if (!raw) return "";
    try {
      const d = new Date(raw);
      return d.toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return raw;
    }
  })();

  const durationText = (() => {
    const s = interview.durationSeconds;
    if (s <= 0 && interview.status === "completed") {
      return t.dashboard.interviewDrawer.durationSeconds.replace("{secs}", "0");
    }
    const hrs = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = s % 60;
    if (hrs > 0) {
      return t.dashboard.interviewDrawer.durationHours
        .replace("{hours}", String(hrs))
        .replace("{mins}", String(mins));
    }
    if (mins > 0) {
      return secs > 0
        ? t.dashboard.interviewDrawer.durationMinSec
            .replace("{mins}", String(mins))
            .replace("{secs}", String(secs))
        : t.dashboard.interviewDrawer.durationMinutes.replace(
            "{mins}",
            String(mins),
          );
    }
    return t.dashboard.interviewDrawer.durationSeconds.replace(
      "{secs}",
      String(secs),
    );
  })();

  const getPersonaLabel = (persona: string) => {
    switch (persona) {
      case "friendly":
        return t.interview.personas.friendly.label;
      case "stressful":
        return t.interview.personas.stressful.label;
      case "standard":
      default:
        return t.interview.personas.standard.label;
    }
  };

  const getInterviewTypeLabel = (type: string) => {
    switch (type) {
      case "behavioral":
        return t.interview.behavioral;
      case "technical":
        return t.interview.technical;
      case "mixed":
      default:
        return t.interview.mixed;
    }
  };

  const getLevelLabel = (level: string) => {
    switch (level) {
      case "Junior":
        return t.interview.levels.Junior;
      case "Mid":
        return t.interview.levels.Mid;
      case "Senior":
        return t.interview.levels.Senior;
      default:
        return level;
    }
  };

  const isCompleted = interview.status === "completed";
  const isCompleting = interview.status === "completing";
  const isFailed = interview.status === "failed";
  const isInitializing = interview.status === "initializing";
  const isActive = interview.status === "active";

  const score = interview.overallScore;
  const scoreBadgeClass =
    typeof score === "number"
      ? score >= 80
        ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
        : score >= 60
          ? "bg-primary/10 text-primary border-primary/20"
          : "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
      : "";

  const progressPercent = Math.min(
    100,
    interview.targetRoundCount > 0
      ? Math.round(
          (interview.answeredRoundCount / interview.targetRoundCount) * 100,
        )
      : 0,
  );

  return (
    <div className="group relative flex flex-col rounded-xl border border-border/70 bg-card p-4 transition-all duration-200 hover:border-primary/40 hover:shadow-xs">
      {/* Header row: Role, Level, Tags */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {showVersionBadge && (
              <Badge
                variant="outline"
                className="bg-muted/50 px-1.5 py-0 text-[10px] font-mono font-medium"
              >
                v{interview.versionNumber}
              </Badge>
            )}
            <h4 className="truncate text-sm font-bold text-foreground">
              {interview.targetRole || t.dashboard.generator.targetRole}
            </h4>
            <Badge
              variant="secondary"
              className="px-1.5 py-0 text-[10px] font-normal"
            >
              {getLevelLabel(interview.targetLevel)}
            </Badge>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span>{getInterviewTypeLabel(interview.interviewType)}</span>
            <span className="opacity-40">·</span>
            <span>{getPersonaLabel(interview.persona)}</span>
          </div>
        </div>

        {/* Status / Score display */}
        <div className="flex shrink-0 flex-col items-end gap-1">
          {isCompleted && (
            <>
              {typeof score === "number" ? (
                <div
                  className={cn(
                    "flex items-baseline gap-1 rounded-lg border px-2.5 py-0.5",
                    scoreBadgeClass,
                  )}
                >
                  <Award className="size-3.5 mr-0.5 self-center" />
                  <span className="text-base font-bold font-mono tracking-tight">
                    {score}
                  </span>
                  <span className="text-[10px] opacity-75">/ 100</span>
                </div>
              ) : (
                <Badge
                  variant="secondary"
                  className="bg-emerald-500/10 text-[10px] text-emerald-600 dark:text-emerald-400"
                >
                  <CheckCircle2 className="size-3" />
                  {t.dashboard.interviewDrawer.statusCompleted}
                </Badge>
              )}
            </>
          )}

          {isCompleting && (
            <Badge
              variant="secondary"
              className="gap-1 bg-amber-500/10 text-[10px] text-amber-600 dark:text-amber-400"
            >
              <Loader2 className="size-3 animate-spin text-amber-500" />
              {t.dashboard.interviewDrawer.statusCompleting}
            </Badge>
          )}

          {(isActive || isInitializing) && (
            <Badge
              variant="secondary"
              className="gap-1 bg-blue-500/10 text-[10px] text-blue-600 dark:text-blue-400"
            >
              <span className="size-1.5 animate-pulse rounded-full bg-blue-500" />
              {isInitializing
                ? t.dashboard.interviewDrawer.statusInitializing
                : t.dashboard.interviewDrawer.statusInProgress}
            </Badge>
          )}

          {isFailed && (
            <Badge variant="destructive" className="gap-1 text-[10px]">
              <AlertCircle className="size-3" />
              {t.dashboard.interviewDrawer.statusFailed}
            </Badge>
          )}
        </div>
      </div>

      {/* Progress Bar (Visualizer) */}
      <div className="mt-2.5 space-y-1">
        <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              "h-full transition-all duration-300",
              isCompleted
                ? "bg-emerald-500"
                : isFailed
                  ? "bg-destructive"
                  : "bg-primary",
            )}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Meta row: Duration, Rounds, Date */}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1">
            <Clock className="size-3.5 opacity-70" />
            {durationText}
          </span>
          <span className="inline-flex items-center gap-1">
            <Sparkles className="size-3.5 opacity-70" />
            {t.dashboard.interviewDrawer.questionsProgress
              .replace("{answered}", String(interview.answeredRoundCount))
              .replace("{total}", String(interview.targetRoundCount))}
          </span>
        </div>
        <span className="font-mono text-[11px] opacity-75">{formattedDate}</span>
      </div>

      {/* Action Buttons row */}
      <div className="mt-3 flex items-center justify-between gap-2 border-t pt-2.5">
        <div className="flex items-center gap-2">
          {isCompleted && (
            <>
              <Button
                size="sm"
                className="h-7 gap-1.5 px-2.5 text-xs font-semibold shadow-xs"
                asChild
              >
                <Link href={`/interviews/${interview.id}/report`}>
                  <FileBarChart2 className="size-3" />
                  {t.dashboard.interviewDrawer.viewReport}
                </Link>
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1 px-2.5 text-xs font-medium"
                asChild
              >
                <Link href={`/interviews/${interview.id}`}>
                  <History className="size-3" />
                  {t.dashboard.interviewDrawer.reviewInterview}
                </Link>
              </Button>
            </>
          )}

          {(isActive || isInitializing || isCompleting) && (
            <Button
              size="sm"
              className="h-7 gap-1 px-3 text-xs font-semibold shadow-xs"
              asChild
            >
              <Link href={`/interviews/${interview.id}`}>
                {t.dashboard.interviewDrawer.continueInterview}
                <ArrowRight className="size-3" />
              </Link>
            </Button>
          )}

          {isFailed && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 border-destructive/30 px-2.5 text-xs text-destructive hover:bg-destructive/10"
              asChild
            >
              <Link href={`/interviews/${interview.id}`}>
                <RotateCcw className="size-3" />
                {t.dashboard.interviewDrawer.retryInterview}
              </Link>
            </Button>
          )}
        </div>

        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="size-7 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
          onClick={() => onDeleteClick(interview)}
          disabled={deleting}
          aria-label={t.dashboard.interviewDrawer.deleteInterview}
        >
          {deleting ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Trash2 className="size-3.5" />
          )}
        </Button>
      </div>
    </div>
  );
}

