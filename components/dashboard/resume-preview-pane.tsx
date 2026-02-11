"use client";

import dynamic from "next/dynamic";
import {
  AlertCircle,
  CheckCircle,
  ChevronRight,
  FileText,
  Loader2,
  Pencil,
  Settings,
} from "lucide-react";
import { useTranslation } from "@/lib/i18n/context";
import type { ParsedResume } from "@/lib/resume/types";
import type { InterviewConfig } from "@/lib/interview/settings";
import { ParsedResumePreview } from "@/components/resume/parsed-resume-preview";
import { ParsedResumeEditor } from "@/components/resume/parsed-resume-editor";
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
  retryingParse: boolean;
  onPreviewModeChange: (mode: "parsed" | "original") => void;
  onRetryParse: () => void;
  selectedInterviewConfig: InterviewConfig | null;
  creatingInterview: boolean;
  onOpenSettings: () => void;
  onStartInterview: () => void;
  editing: boolean;
  savingEdit: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (data: ParsedResume) => Promise<void>;
}

export function ResumePreviewPane({
  selectedResumeTitle,
  selectedVersion,
  parsed,
  activePreviewMode,
  hasParsedPreview,
  hasOriginalPreview,
  parseFailureHint,
  retryingParse,
  onPreviewModeChange,
  onRetryParse,
  selectedInterviewConfig,
  creatingInterview,
  onOpenSettings,
  onStartInterview,
  editing,
  savingEdit,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
}: ResumePreviewPaneProps) {
  const { t } = useTranslation();
  return (
    <>
      <header className="flex items-center justify-between border-b bg-card px-6 py-3">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">{t.dashboard.resumes}</span>
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
              {t.dashboard.parsedSuccessfully}
            </Badge>
          )}
          {selectedVersion.parseStatus === "failed" && (
            <Badge variant="destructive" className="gap-1">
              <AlertCircle className="size-3" />
              {t.dashboard.parsingFailed}
            </Badge>
          )}
          {selectedVersion.parseStatus !== "parsed" &&
            selectedVersion.parseStatus !== "failed" && (
              <Badge variant="secondary" className="gap-1">
                <Loader2 className="size-3 animate-spin" />
                {t.dashboard.parsing}
              </Badge>
            )}

          {hasParsedPreview && !editing && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              onClick={onStartEdit}
            >
              <Pencil className="size-3" />
              {t.dashboard.editResume}
            </Button>
          )}

          <div className="inline-flex items-center rounded-md border bg-muted/30 p-0.5">
            <Button
              type="button"
              size="sm"
              variant={activePreviewMode === "parsed" ? "secondary" : "ghost"}
              className="h-7 px-2 text-xs"
              onClick={() => onPreviewModeChange("parsed")}
              disabled={!hasParsedPreview || editing}
            >
              {t.dashboard.parsed}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={activePreviewMode === "original" ? "secondary" : "ghost"}
              className="h-7 px-2 text-xs"
              onClick={() => onPreviewModeChange("original")}
              disabled={!hasOriginalPreview || editing}
            >
              {t.dashboard.original}
            </Button>
          </div>
        </div>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex justify-center px-8 py-8 pb-24">
          {editing && parsed ? (
            <ParsedResumeEditor
              parsed={parsed}
              onSave={onSaveEdit}
              onCancel={onCancelEdit}
              saving={savingEdit}
            />
          ) : activePreviewMode === "parsed" && parsed ? (
            <ParsedResumePreview parsed={parsed} />
          ) : hasOriginalPreview ? (
            <div className="w-full max-w-[1000px] space-y-4">
              {selectedVersion.parseStatus === "failed" && (
                <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4">
                  <p className="text-sm font-medium text-destructive">
                    {t.dashboard.parsingFailedShowOriginal}
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
                  <div className="mt-3">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={onRetryParse}
                      disabled={retryingParse}
                    >
                      {retryingParse ? (
                        <>
                          <Loader2 className="size-4 animate-spin" />
                          {t.dashboard.reParsing}
                        </>
                      ) : (
                        t.dashboard.retryParsing
                      )}
                    </Button>
                  </div>
                </div>
              )}

              {selectedVersion.parseStatus !== "parsed" &&
                selectedVersion.parseStatus !== "failed" && (
                  <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
                    {t.dashboard.parsingWaiting}
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
                  {t.dashboard.originalUnavailable}
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
              {t.dashboard.settingsSaved}
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
              ? t.dashboard.resumeNotReady
              : creatingInterview
                ? t.dashboard.startingInterview
                : selectedInterviewConfig
                  ? t.dashboard.startInterview
                  : t.dashboard.configureFirst}
          </Button>
        </div>
      </div>
    </>
  );
}
