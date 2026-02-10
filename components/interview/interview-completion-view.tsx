"use client";

import type { ReactNode } from "react";
import {
  ArrowRight,
  CheckCheck,
  Clock3,
  FileText,
  Lightbulb,
  Loader2,
  ListChecks,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface InterviewCompletionViewProps {
  title: string;
  description: string;
  processingLabel: string;
  isProcessing: boolean;
  durationLabel: string;
  durationValue: string;
  questionsLabel: string;
  questionsValue: string;
  resumeLabel: string;
  resumeValue: string;
  reportButtonLabel: string;
  dashboardButtonLabel: string;
  tipText: string;
  isReportButtonDisabled: boolean;
  onViewReport: () => void;
  onBackToDashboard: () => void;
}

interface SummaryItemProps {
  icon: ReactNode;
  label: string;
  value: string;
  className?: string;
}

function SummaryItem({ icon, label, value, className }: SummaryItemProps) {
  return (
    <div className={`flex flex-col items-center gap-2 text-center ${className ?? ""}`}>
      <div className="flex size-10 items-center justify-center rounded-full bg-background shadow-sm ring-1 ring-border/60">
        {icon}
      </div>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </p>
        <p className="mt-1 text-lg font-bold text-foreground">{value}</p>
      </div>
    </div>
  );
}

export function InterviewCompletionView({
  title,
  description,
  processingLabel,
  isProcessing,
  durationLabel,
  durationValue,
  questionsLabel,
  questionsValue,
  resumeLabel,
  resumeValue,
  reportButtonLabel,
  dashboardButtonLabel,
  tipText,
  isReportButtonDisabled,
  onViewReport,
  onBackToDashboard,
}: InterviewCompletionViewProps) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-muted/40 px-4 py-8 sm:px-6">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-24 -left-24 size-96 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute -right-16 -bottom-24 size-96 rounded-full bg-primary/10 blur-3xl" />
      </div>

      <main className="relative mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-3xl items-center">
        <section className="w-full overflow-hidden rounded-2xl border bg-card shadow-2xl shadow-primary/10">
          <div className="h-1.5 w-full bg-primary" />

          <div className="px-6 py-8 sm:px-10 sm:py-10">
            <div className="mx-auto mb-7 flex w-fit items-center justify-center">
              <div className="relative">
                <div className="flex size-24 items-center justify-center rounded-full bg-primary/10 text-primary ring-1 ring-primary/20">
                  <CheckCheck className="size-12" />
                </div>
                <span className="absolute -top-1 -right-1 size-4 animate-pulse rounded-full bg-yellow-400" />
                <span className="absolute -left-5 top-10 size-2.5 rounded-full bg-primary/40" />
                <span className="absolute right-4 -bottom-2 size-3 rounded-full bg-blue-200 dark:bg-blue-800" />
              </div>
            </div>

            <div className="mx-auto mb-9 max-w-xl text-center">
              <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                {title}
              </h1>
              <p className="mt-3 text-base leading-relaxed text-muted-foreground sm:text-lg">
                {description}
              </p>
              {isProcessing && (
                <p className="mt-4 inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary">
                  <Loader2 className="size-4 animate-spin" />
                  {processingLabel}
                </p>
              )}
            </div>

            <div className="mb-9 grid grid-cols-1 gap-6 rounded-xl border bg-muted/30 p-6 sm:grid-cols-3 sm:p-8">
              <SummaryItem
                icon={<Clock3 className="size-5 text-primary" />}
                label={durationLabel}
                value={durationValue}
              />
              <SummaryItem
                icon={<ListChecks className="size-5 text-primary" />}
                label={questionsLabel}
                value={questionsValue}
                className="border-y border-border/60 py-5 sm:border-y-0 sm:border-x sm:py-0"
              />
              <SummaryItem
                icon={<FileText className="size-5 text-primary" />}
                label={resumeLabel}
                value={resumeValue}
              />
            </div>

            <div className="mx-auto w-full max-w-sm space-y-3">
              <Button
                size="lg"
                className="group h-12 w-full text-base"
                onClick={onViewReport}
                disabled={isReportButtonDisabled}
              >
                <span>{reportButtonLabel}</span>
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
              </Button>
              <Button
                variant="ghost"
                size="lg"
                className="h-12 w-full text-base text-muted-foreground hover:text-foreground"
                onClick={onBackToDashboard}
              >
                {dashboardButtonLabel}
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-2 border-t bg-muted/40 px-6 py-4 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-10">
            <div className="inline-flex items-center gap-2">
              <Lightbulb className="size-4 text-primary" />
              <span>{tipText}</span>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
