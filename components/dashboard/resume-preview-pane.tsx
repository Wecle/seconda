"use client";

import dynamic from "next/dynamic";
import {
  AlertCircle,
  CheckCircle,
  ChevronRight,
  FileText,
  Loader2,
  Settings,
} from "lucide-react";
import type { ParsedResume } from "@/lib/resume/types";
import type { InterviewConfig } from "@/lib/interview/settings";
import { ParsedResumePreview } from "@/components/resume/parsed-resume-preview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ResumeVersion } from "@/components/dashboard/types";

const ResumePdfPreview = dynamic(
  () =>
    import("@/components/resume/pdf-preview").then(
      (module) => module.ResumePdfPreview,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[calc(100vh-380px)] items-center justify-center rounded-md border bg-muted/20">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    ),
  },
);

interface ResumePreviewPaneProps {
  selectedResumeTitle?: string;
  selectedVersion: ResumeVersion;
  parsed: ParsedResume | null | undefined;
  activePreviewMode: "parsed" | "original";
  hasParsedPreview: boolean;
  hasOriginalPreview: boolean;
  parseFailureHint: string;
  onPreviewModeChange: (mode: "parsed" | "original") => void;
  selectedInterviewConfig: InterviewConfig | null;
  creatingInterview: boolean;
  onOpenSettings: () => void;
  onStartInterview: () => void;
}

export function ResumePreviewPane({
  selectedResumeTitle,
  selectedVersion,
  parsed,
  activePreviewMode,
  hasParsedPreview,
  hasOriginalPreview,
  parseFailureHint,
  onPreviewModeChange,
  selectedInterviewConfig,
  creatingInterview,
  onOpenSettings,
  onStartInterview,
}: ResumePreviewPaneProps) {
  return (
    <>
      <header className="flex items-center justify-between border-b bg-card px-6 py-3">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Resumes</span>
          <ChevronRight className="size-3.5 text-muted-foreground" />
          <span className="text-muted-foreground">{selectedResumeTitle}</span>
          <ChevronRight className="size-3.5 text-muted-foreground" />
          <span className="font-medium">v{selectedVersion.versionNumber}</span>
        </div>
        <div className="flex items-center gap-3">
          {selectedVersion.parseStatus === "parsed" && (
            <Badge
              variant="secondary"
              className="gap-1 bg-emerald-50 text-emerald-700"
            >
              <CheckCircle className="size-3" />
              Parsed Successfully
            </Badge>
          )}
          {selectedVersion.parseStatus === "failed" && (
            <Badge variant="destructive" className="gap-1">
              <AlertCircle className="size-3" />
              Parsing Failed
            </Badge>
          )}
          {selectedVersion.parseStatus !== "parsed" &&
            selectedVersion.parseStatus !== "failed" && (
              <Badge variant="secondary" className="gap-1">
                <Loader2 className="size-3 animate-spin" />
                Parsing...
              </Badge>
            )}

          <div className="inline-flex items-center rounded-md border bg-muted/30 p-0.5">
            <Button
              type="button"
              size="sm"
              variant={activePreviewMode === "parsed" ? "secondary" : "ghost"}
              className="h-7 px-2 text-xs"
              onClick={() => onPreviewModeChange("parsed")}
              disabled={!hasParsedPreview}
            >
              Parsed
            </Button>
            <Button
              type="button"
              size="sm"
              variant={activePreviewMode === "original" ? "secondary" : "ghost"}
              className="h-7 px-2 text-xs"
              onClick={() => onPreviewModeChange("original")}
              disabled={!hasOriginalPreview}
            >
              Original
            </Button>
          </div>
        </div>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex justify-center px-8 py-8 pb-24">
          {activePreviewMode === "parsed" && parsed ? (
            <ParsedResumePreview parsed={parsed} />
          ) : hasOriginalPreview ? (
            <div className="w-full max-w-[1000px] space-y-4">
              {selectedVersion.parseStatus === "failed" && (
                <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4">
                  <p className="text-sm font-medium text-destructive">
                    Parsing failed. Showing original PDF.
                  </p>
                  {selectedVersion.parseError && (
                    <p className="mt-1 text-xs leading-relaxed text-foreground">
                      {selectedVersion.parseError}
                    </p>
                  )}
                  {parseFailureHint && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {parseFailureHint}
                    </p>
                  )}
                </div>
              )}

              {selectedVersion.parseStatus !== "parsed" &&
                selectedVersion.parseStatus !== "failed" && (
                  <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
                    Resume is being parsed. You can review the original PDF
                    while waiting.
                  </div>
                )}

              <ResumePdfPreview
                key={selectedVersion.originalFileUrl}
                fileUrl={selectedVersion.originalFileUrl!}
                filename={selectedVersion.originalFilename}
              />
            </div>
          ) : (
            <div className="flex min-h-[300px] w-full max-w-[850px] items-center justify-center rounded-xl border border-dashed bg-card">
              <div className="space-y-2 text-center">
                <AlertCircle className="mx-auto size-10 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">
                  Original file preview is unavailable for this version.
                </p>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between border-t bg-card/95 px-6 py-3 backdrop-blur-sm">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <FileText className="size-4" />
          <span>
            {selectedResumeTitle} -{" "}
            <span className="font-medium text-foreground">
              v{selectedVersion.versionNumber}
            </span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          {selectedInterviewConfig && (
            <Badge variant="secondary" className="h-8">
              Settings Saved
            </Badge>
          )}
          <Button variant="outline" size="icon-sm" onClick={onOpenSettings}>
            <Settings className="size-4" />
          </Button>
          <Button
            size="sm"
            disabled={
              selectedVersion.parseStatus !== "parsed" ||
              !selectedInterviewConfig ||
              creatingInterview
            }
            onClick={onStartInterview}
          >
            {selectedVersion.parseStatus !== "parsed"
              ? "Resume Not Ready for Interview"
              : creatingInterview
                ? "Starting Interview..."
                : selectedInterviewConfig
                  ? "Start Interview with this Version"
                  : "Configure Settings First"}
          </Button>
        </div>
      </div>
    </>
  );
}
