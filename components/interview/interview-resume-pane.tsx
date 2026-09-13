"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import dynamic from "next/dynamic";
import {
  AlertCircle,
  Crosshair,
  File,
  FileCode2,
  Loader2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ParsedResumePreview } from "@/components/resume/parsed-resume-preview";
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
      <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border/70 bg-background/90 px-4 backdrop-blur-sm">
        {/* Left: View Mode Tabs */}
        {hasOriginal ? (
          <div
            role="tablist"
            aria-label="简历查看模式"
            className="inline-flex h-8 items-center rounded-lg bg-muted/60 p-0.5 text-xs"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "parsed"}
              onClick={() => setActiveTab("parsed")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-all duration-150",
                activeTab === "parsed"
                  ? "bg-background text-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <FileCode2 className="size-3.5 text-primary" />
              <span>结构化</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "original"}
              onClick={() => setActiveTab("original")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-all duration-150",
                activeTab === "original"
                  ? "bg-background text-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <File className="size-3.5 text-muted-foreground" />
              <span>PDF原件</span>
            </button>
          </div>
        ) : (
          <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <FileCode2 className="size-4 text-primary" />
            <span>结构化简历</span>
          </div>
        )}

        {/* Right: Fact Highlights Info, Locate Button & Close */}
        <div className="flex items-center gap-2">
          {activeCount > 0 && (
            <div className="flex items-center gap-1.5">
              <div className="flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-700 dark:text-amber-300">
                <span className="size-1.5 rounded-full bg-amber-500 animate-pulse" />
                <span className="text-[11px] font-semibold">{activeCount} 处事实</span>
                {isInherited && (
                  <span className="text-[10px] text-amber-600/80 dark:text-amber-400/80">(继承)</span>
                )}
              </div>

              {activeTab === "parsed" && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleLocateActive}
                  title="定位到当前高亮事实"
                  className="h-7 gap-1 px-2 text-xs text-primary hover:bg-primary/10"
                >
                  <Crosshair className="size-3.5" />
                  <span className="hidden sm:inline text-xs">定位高亮</span>
                </Button>
              )}
            </div>
          )}

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

      {/* Pane Content Area */}
      <ScrollArea ref={scrollAreaRef} className="min-h-0 flex-1 bg-muted/20">
        <div className="flex justify-center p-4 sm:p-6 lg:p-8">
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
              <ParsedResumePreview
                parsed={data.parsedJson}
                activePaths={activeEvidencePaths}
                persistentPaths={persistentEvidencePaths}
                isInherited={isInherited}
              />
            ) : hasOriginal && data.originalFileUrl && data.originalFilename ? (
              <div className="w-full max-w-[850px]">
                <ResumePdfPreview
                  fileUrl={data.originalFileUrl}
                  filename={data.originalFilename}
                />
              </div>
            ) : null
          ) : null}
        </div>
      </ScrollArea>
    </div>
  );
}
