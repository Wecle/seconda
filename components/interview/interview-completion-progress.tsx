"use client";

import { Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export type ScoringProgress = { total: number; pending: number; scoring: number; scored: number; failed: number };

export function buildCompletionView(status: string, progress?: ScoringProgress | null) {
  if (status === "completed") return { label: "评分与报告已完成", reportEnabled: true, failed: false };
  if (status === "failed") return { label: "评分或报告生成未完成", reportEnabled: false, failed: true };
  if (status === "reporting") return { label: "正在生成综合报告", reportEnabled: false, failed: false };
  return { label: `正在评分 ${progress?.scored ?? 0}/${progress?.total ?? 0}`, reportEnabled: false, failed: false };
}

export function InterviewCompletionProgress({ status, progress, onRetry }: { status: string; progress?: ScoringProgress | null; onRetry?: () => void }) {
  const view = buildCompletionView(status, progress);
  return <div className="flex items-center gap-3 rounded-xl border bg-card p-4">
    {!view.failed && status !== "completed" && <Loader2 className="size-5 animate-spin text-primary" />}
    <div className="flex-1"><p className="font-medium">{view.label}</p>{progress && status === "scoring" && <p className="text-sm text-muted-foreground">已完成 {progress.scored} 项，剩余 {progress.pending + progress.scoring + progress.failed} 项</p>}</div>
    {view.failed && onRetry && <Button variant="outline" onClick={onRetry}><RotateCcw className="size-4" />恢复任务</Button>}
  </div>;
}
