import { useState, useEffect, useCallback, useMemo } from "react";
import dynamic from "next/dynamic";
import {
  AlertCircle,
  ArrowRight,
  Briefcase,
  CheckCircle,
  ChevronRight,
  Code,
  FileText,
  GraduationCap,
  History,
  Loader2,
  Pencil,
  Settings,
  Sparkles,
} from "lucide-react";
import { useTranslation } from "@/lib/i18n/context";
import type { ParsedResume } from "@/lib/resume/types";
import { ParsedResumePreview } from "@/components/resume/parsed-resume-preview";
import { ParsedResumeEditor } from "@/components/resume/parsed-resume-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type {
  InterviewSummaryItem,
  ResumeVersion,
} from "@/components/dashboard/types";
import { InterviewHistoryDrawer } from "@/components/dashboard/interview-history-drawer";
import { cn } from "@/lib/utils";

const ResumePdfPreview = dynamic(
  () =>
    import("@/components/resume/pdf-preview").then(
      (module) => module.ResumePdfPreview,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[calc(100vh-380px)] items-center justify-center rounded-xl border bg-muted/20">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    ),
  },
);

interface ResumePreviewPaneProps {
  selectedResumeId?: string;
  selectedResumeTitle?: string;
  selectedVersion: ResumeVersion;
  parsed: ParsedResume | null | undefined;
  activePreviewMode: "parsed" | "original";
  hasParsedPreview: boolean;
  hasOriginalPreview: boolean;
  parseFailureHint: string;
  retryingParse: boolean;
  hasSavedSettings?: boolean;
  onPreviewModeChange: (mode: "parsed" | "original") => void;
  onRetryParse: () => void;
  onOpenSettings?: () => void;
  onStartInterview: () => void;
  editing: boolean;
  savingEdit: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (data: ParsedResume) => Promise<void>;
}

export function ResumePreviewPane({
  selectedResumeId,
  selectedResumeTitle,
  selectedVersion,
  parsed,
  activePreviewMode,
  hasParsedPreview,
  hasOriginalPreview,
  parseFailureHint,
  retryingParse,
  hasSavedSettings,
  onPreviewModeChange,
  onRetryParse,
  onOpenSettings,
  onStartInterview,
  editing,
  savingEdit,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
}: ResumePreviewPaneProps) {
  const { t } = useTranslation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [interviews, setInterviews] = useState<InterviewSummaryItem[]>([]);

  const handleInterviewsUpdated = useCallback(
    (items: InterviewSummaryItem[]) => {
      setInterviews(items);
    },
    [],
  );

  useEffect(() => {
    if (!selectedResumeId) return;
    let active = true;
    fetch(`/api/resumes/${selectedResumeId}/interviews`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data: InterviewSummaryItem[]) => {
        if (active && Array.isArray(data)) {
          setInterviews(data);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [selectedResumeId]);

  const versionInterviews = useMemo(() => {
    return interviews.filter(
      (item) => item.resumeVersionId === selectedVersion.id,
    );
  }, [interviews, selectedVersion.id]);

  const interviewCount = versionInterviews.length;

  const highestScore = useMemo(() => {
    const scored = versionInterviews
      .filter((i) => typeof i.overallScore === "number")
      .map((i) => i.overallScore as number);
    return scored.length > 0 ? Math.max(...scored) : null;
  }, [versionInterviews]);

  const originalFileUrl = selectedVersion.originalFileUrl;
  const originalFilename = selectedVersion.originalFilename;
  const isGenerated = selectedVersion.sourceType === "generated";
  const canRenderOriginal = Boolean(
    !isGenerated && hasOriginalPreview && originalFileUrl && originalFilename,
  );

  return (
    <>
      {/* Header Toolbar */}
      <header className="flex items-center justify-between border-b bg-card/95 px-6 py-3 backdrop-blur-sm">
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">{t.dashboard.resumes}</span>
          <ChevronRight className="size-3.5 text-muted-foreground/60" />
          <span className="font-medium text-foreground max-w-[200px] truncate">
            {selectedResumeTitle}
          </span>
          <ChevronRight className="size-3.5 text-muted-foreground/60" />
          <Badge
            variant="outline"
            className="gap-1 font-mono font-medium text-[11px] bg-muted/40"
          >
            {isGenerated ? (
              <Sparkles className="size-3 text-amber-500" />
            ) : (
              <FileText className="size-3 text-primary" />
            )}
            v{selectedVersion.versionNumber}
          </Badge>
        </div>

        <div className="flex items-center gap-2.5">
          {/* Status Badge */}
          {selectedVersion.parseStatus === "parsed" && (
            <div className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
              <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
              {t.dashboard.parsedSuccessfully}
            </div>
          )}
          {selectedVersion.parseStatus === "failed" && (
            <Badge variant="destructive" className="gap-1 text-xs">
              <AlertCircle className="size-3" />
              {t.dashboard.parsingFailed}
            </Badge>
          )}
          {selectedVersion.parseStatus !== "parsed" &&
            selectedVersion.parseStatus !== "failed" && (
              <Badge variant="secondary" className="gap-1 text-xs">
                <Loader2 className="size-3 animate-spin text-amber-500" />
                {t.dashboard.parsing}
              </Badge>
            )}

          {/* Quick Edit Action */}
          {hasParsedPreview && !editing && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 px-2.5 text-xs transition-all active:scale-95"
              onClick={onStartEdit}
            >
              <Pencil className="size-3.5" />
              {t.dashboard.editResume}
            </Button>
          )}

          {/* Mode Switcher Segmented Pill */}
          <div className="inline-flex items-center rounded-lg border bg-muted/40 p-0.5">
            <Button
              type="button"
              size="sm"
              variant={activePreviewMode === "parsed" ? "secondary" : "ghost"}
              className="h-7 px-2.5 text-xs font-medium"
              onClick={() => onPreviewModeChange("parsed")}
              disabled={!hasParsedPreview || editing}
            >
              {t.dashboard.parsed}
            </Button>
            {isGenerated ? (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      tabIndex={0}
                      className="inline-flex"
                      role="button"
                      aria-disabled="true"
                      aria-label={t.dashboard.generatedNoOriginal}
                    >
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2.5 text-xs text-muted-foreground/50"
                        disabled
                      >
                        {t.dashboard.original}
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {t.dashboard.generatedNoOriginal}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : (
              <Button
                type="button"
                size="sm"
                variant={
                  activePreviewMode === "original" ? "secondary" : "ghost"
                }
                className="h-7 px-2.5 text-xs font-medium"
                onClick={() => onPreviewModeChange("original")}
                disabled={!hasOriginalPreview || editing}
              >
                {t.dashboard.original}
              </Button>
            )}
          </div>

          {/* Interview Records Hub Button */}

          {/* Interview History Drawer Trigger */}
          {selectedResumeId && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs font-medium"
              onClick={() => setDrawerOpen(true)}
            >
              <History className="size-3.5 text-primary" />
              <span>{t.dashboard.interviewRecords}</span>
              {interviewCount > 0 && (
                <span className="rounded-full bg-primary/10 px-1.5 py-0 font-mono text-[10px] font-bold text-primary">
                  {interviewCount}
                </span>
              )}
            </Button>
          )}
        </div>
      </header>

      {/* Main Preview Scroll Canvas */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col items-center px-6 py-6 pb-28 space-y-6">
          {/* Executive Quick-Insights Ribbon */}
          {hasParsedPreview && parsed && !editing && activePreviewMode === "parsed" && (
            <div className="w-full max-w-[850px] rounded-xl border bg-card/60 p-4 shadow-xs backdrop-blur-xs transition-all hover:border-primary/30">
              <div className="flex flex-wrap items-center gap-4 text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-foreground">
                    {parsed.title || selectedResumeTitle}
                  </span>
                </div>

                <div className="hidden h-3.5 w-px bg-border sm:block" />

                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Code className="size-3.5 text-primary" />
                  <span>
                    {t.dashboard.insights.skillsCount.replace(
                      "{count}",
                      String(parsed.skills.length),
                    )}
                  </span>
                </div>

                <div className="hidden h-3.5 w-px bg-border sm:block" />

                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Briefcase className="size-3.5 text-primary" />
                  <span>
                    {t.dashboard.insights.experienceCount.replace(
                      "{count}",
                      String(parsed.experience.length),
                    )}
                  </span>
                </div>

                {parsed.education && parsed.education.length > 0 && (
                  <>
                    <div className="hidden h-3.5 w-px bg-border sm:block" />
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <GraduationCap className="size-3.5 text-primary" />
                      <span>
                        {t.dashboard.insights.educationCount.replace(
                          "{count}",
                          String(parsed.education.length),
                        )}
                      </span>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Document Render Zone */}
          {editing && parsed ? (
            <ParsedResumeEditor
              parsed={parsed}
              onSave={onSaveEdit}
              onCancel={onCancelEdit}
              saving={savingEdit}
            />
          ) : activePreviewMode === "parsed" && parsed ? (
            <ParsedResumePreview parsed={parsed} />
          ) : canRenderOriginal && originalFileUrl && originalFilename ? (
            <div className="w-full max-w-[1000px] space-y-4">
              {selectedVersion.parseStatus === "failed" && (
                <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4">
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
                          <Loader2 className="size-4 animate-spin mr-1.5" />
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
                  <div className="rounded-xl border bg-muted/30 p-3 text-xs text-muted-foreground">
                    {t.dashboard.parsingWaiting}
                  </div>
                )}

              <ResumePdfPreview
                key={originalFileUrl}
                fileUrl={originalFileUrl}
                filename={originalFilename}
              />
            </div>
          ) : (
            <div className="flex min-h-[320px] w-full max-w-[850px] items-center justify-center rounded-2xl border border-dashed bg-card/50">
              <div className="space-y-2 text-center p-6">
                <AlertCircle className="mx-auto size-10 text-muted-foreground/40" />
                <p className="text-sm font-medium text-muted-foreground">
                  {t.dashboard.originalUnavailable}
                </p>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Floating Bottom Action Dock */}
      <div className="absolute inset-x-0 bottom-4 flex justify-center pointer-events-none px-4">
        <div className="pointer-events-auto flex items-center justify-between gap-4 rounded-2xl border border-border/80 bg-card/90 px-5 py-3 shadow-xl backdrop-blur-md w-full max-w-[850px] transition-all">
          <div className="flex items-center gap-2 text-xs text-muted-foreground min-w-0">
            <FileText className="size-4 text-primary shrink-0" />
            <span className="truncate">
              <span className="font-semibold text-foreground">
                {selectedResumeTitle}
              </span>
              <span className="ml-1.5 font-mono text-[11px] opacity-80">
                v{selectedVersion.versionNumber}
              </span>
            </span>
            {hasSavedSettings && (
              <Badge
                variant="secondary"
                className="hidden sm:inline-flex ml-2 h-5 text-[10px] font-normal"
              >
                {t.dashboard.settingsSaved}
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="size-9 rounded-xl transition-all active:scale-95"
                    onClick={onOpenSettings}
                    disabled={selectedVersion.parseStatus !== "parsed"}
                    aria-label={t.interview.settingsTitle}
                  >
                    <Settings className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  {t.interview.settingsTitle}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <Button
              size="sm"
              className="gap-2 rounded-xl px-4 py-2 text-xs font-semibold shadow-md transition-all active:scale-[0.98]"
              disabled={selectedVersion.parseStatus !== "parsed"}
              onClick={onStartInterview}
            >
              <span>{t.dashboard.startInterview}</span>
              <ArrowRight className="size-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Drawer */}
      <InterviewHistoryDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        resumeId={selectedResumeId ?? null}
        resumeTitle={selectedResumeTitle}
        selectedVersionId={selectedVersion.id}
        selectedVersionNumber={selectedVersion.versionNumber}
        onStartInterview={onStartInterview}
        onInterviewsUpdated={handleInterviewsUpdated}
      />
    </>
  );
}

