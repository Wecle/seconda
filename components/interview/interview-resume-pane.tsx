"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import dynamic from "next/dynamic";
import {
  AlertCircle,
  Crosshair,
  FileText,
  Loader2,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { InterviewParsedResumeView } from "./interview-parsed-resume-view";
import type { ParsedResume } from "@/lib/resume/types";
import { cn } from "@/lib/utils";

const ResumePdfPreview = dynamic(
  () =>
    import("@/components/resume/pdf-preview").then(
      (module) => module.ResumePdfPreview,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-96 items-center justify-center rounded-xl border bg-muted/20">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    ),
  },
);

export interface InterviewResumeSnapshotResponse {
  interviewId: string;
  resumeId: string;
  resumeVersionId: string;
  resumeTitle: string;
  versionNumber: number;
  sourceType: "uploaded" | "generated";
  parsedJson: ParsedResume;
  evidenceJson: Record<string, { path: string; text: string }>;
  originalFileUrl: string | null;
  originalFilename: string | null;
}

interface InterviewResumePaneProps {
  interviewId: string;
  isOpen: boolean;
  onClose: () => void;
  activeEvidencePaths: Set<string>;
  persistentEvidencePaths: Set<string>;
  activeCount: number;
  isInherited?: boolean;
  onDataLoaded?: (data: InterviewResumeSnapshotResponse) => void;
  className?: string;
}

export function InterviewResumePane({
  interviewId,
  isOpen,
  onClose,
  activeEvidencePaths,
  persistentEvidencePaths,
  activeCount,
  isInherited = false,
  onDataLoaded,
  className,
}: InterviewResumePaneProps) {
  const [data, setData] = useState<InterviewResumeSnapshotResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"parsed" | "original">("parsed");
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const fetchedRef = useRef(false);

  const fetchResumeSnapshot = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/interviews/${interviewId}/resume`);
      if (!response.ok) {
        throw new Error("Failed to load interview resume snapshot");
      }
      const snapshot: InterviewResumeSnapshotResponse = await response.json();
      setData(snapshot);
      onDataLoaded?.(snapshot);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load resume");
    } finally {
      setLoading(false);
    }
  }, [interviewId, onDataLoaded]);

  useEffect(() => {
    if (isOpen && !fetchedRef.current) {
      fetchedRef.current = true;
      void fetchResumeSnapshot();
    }
  }, [isOpen, fetchResumeSnapshot]);

  const handleLocateActive = () => {
    if (activeTab !== "parsed") {
      setActiveTab("parsed");
    }
    setTimeout(() => {
      const firstActive = scrollAreaRef.current?.querySelector('[data-active-fact="true"]');
      if (firstActive) {
        firstActive.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 100);
  };

  const hasOriginal = Boolean(
    data?.sourceType === "uploaded" && data.originalFileUrl && data.originalFilename,
  );

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col border-l border-border/80 bg-background/95 backdrop-blur-md transition-all",
        className,
      )}
    >
      {/* Pane Header Toolbar */}
      <div className="flex h-15 shrink-0 items-center justify-between gap-3 border-b border-border/70 px-4">
        <div className="flex min-w-0 items-center gap-2">
          <div className="grid size-7 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
            <FileText className="size-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-xs font-semibold text-foreground">
                {data?.resumeTitle || "简历对照"}
              </span>
              {data ? (
                <Badge variant="outline" className="h-4.5 px-1 font-mono text-[10px] text-muted-foreground">
                  v{data.versionNumber}
                </Badge>
              ) : null}
            </div>
          </div>
        </div>

        {/* View Mode Switcher */}
        {hasOriginal && (
          <div className="inline-flex items-center rounded-lg border bg-muted/40 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setActiveTab("parsed")}
              className={cn(
                "rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors",
                activeTab === "parsed"
                  ? "bg-background text-foreground shadow-2xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              结构化
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("original")}
              className={cn(
                "rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors",
                activeTab === "original"
                  ? "bg-background text-foreground shadow-2xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              PDF原件
            </button>
          </div>
        )}

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="收起简历面板"
            className="size-7 text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </Button>
        </div>
      </div>

      {/* Facts Sub-bar */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/50 bg-muted/30 px-4 py-2 text-xs">
        <div className="flex min-w-0 items-center gap-2">
          {activeCount > 0 ? (
            <div className="flex items-center gap-1.5 text-amber-700 dark:text-amber-300">
              <span className="size-2 rounded-full bg-amber-500 animate-pulse" />
              <span className="font-medium text-[11px]">
                当前关联 {activeCount} 处事实
              </span>
              {isInherited && (
                <span className="rounded bg-amber-500/10 px-1 py-0.5 text-[10px] text-amber-600 dark:text-amber-400">
                  (继承自上一问)
                </span>
              )}
            </div>
          ) : (
            <span className="text-[11px] text-muted-foreground">
              本题未直接引用简历事实
            </span>
          )}
        </div>

        {activeCount > 0 && activeTab === "parsed" && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleLocateActive}
            className="h-6 gap-1 px-1.5 text-[11px] text-primary hover:bg-primary/10"
          >
            <Crosshair className="size-3" />
            <span>定位高亮</span>
          </Button>
        )}
      </div>

      {/* Pane Content Area */}
      <ScrollArea ref={scrollAreaRef} className="min-h-0 flex-1">
        <div className="p-4 sm:p-6">
          {loading ? (
            <div className="flex h-64 flex-col items-center justify-center gap-3">
              <Loader2 className="size-6 animate-spin text-primary" />
              <p className="text-xs text-muted-foreground">正在加载简历快照…</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center">
              <AlertCircle className="size-8 text-destructive" />
              <p className="text-sm font-medium text-destructive">{error}</p>
              <Button size="sm" variant="outline" onClick={() => void fetchResumeSnapshot()}>
                重试加载
              </Button>
            </div>
          ) : data ? (
            activeTab === "parsed" ? (
              <InterviewParsedResumeView
                parsed={data.parsedJson}
                activePaths={activeEvidencePaths}
                persistentPaths={persistentEvidencePaths}
                isInherited={isInherited}
              />
            ) : hasOriginal && data.originalFileUrl && data.originalFilename ? (
              <ResumePdfPreview
                fileUrl={data.originalFileUrl}
                filename={data.originalFilename}
              />
            ) : null
          ) : null}
        </div>
      </ScrollArea>
    </div>
  );
}
