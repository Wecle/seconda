"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Award,
  Briefcase,
  Loader2,
  Sparkles,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "@/lib/i18n/context";
import { DeleteResumeDialog } from "@/components/dashboard/delete-resume-dialog";
import { ErrorAlertDialog } from "@/components/dashboard/error-alert-dialog";
import { ResumePreviewPane } from "@/components/dashboard/resume-preview-pane";
import { ResumeSidebar } from "@/components/dashboard/resume-sidebar";
import type { Resume, ResumeInterviewSettings } from "@/components/dashboard/types";
import type { UserAvatarMenuUser } from "@/components/auth/user-avatar-menu";
import {
  NewResumeDialog,
  type NewResumeMode,
} from "@/components/dashboard/new-resume-dialog";
import type { GeneratedResumeDraft } from "@/lib/resume/generation-contract";
import type { ParsedResume } from "@/lib/resume/types";
import { InterviewSettingsDialog } from "@/components/interview/interview-settings-dialog";

const EMPTY_GENERATED_DRAFT: GeneratedResumeDraft = {
  name: "",
  targetRole: "",
  coreSkills: "",
  education: "",
  workExperience: "",
  additionalInfo: "",
};

export default function DashboardPage() {
  const { locale, t } = useTranslation();
  const [currentUser, setCurrentUser] = useState<UserAvatarMenuUser | null>(
    null,
  );
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [loading, setLoading] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [selectedResumeId, setSelectedResumeId] = useState<string | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(
    null,
  );
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set(),
  );
  const [uploadOpen, setUploadOpen] = useState(false);
  const [newResumeMode, setNewResumeMode] =
    useState<NewResumeMode>("upload");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [generatedDraft, setGeneratedDraft] = useState<GeneratedResumeDraft>(
    EMPTY_GENERATED_DRAFT,
  );
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [deletingResumeId, setDeletingResumeId] = useState<string | null>(null);
  const [pendingDeleteResume, setPendingDeleteResume] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const [uploadTitle, setUploadTitle] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewMode, setPreviewMode] = useState<"parsed" | "original">(
    "parsed",
  );
  const [retryingVersionId, setRetryingVersionId] = useState<string | null>(
    null,
  );
  const [errorAlertMessage, setErrorAlertMessage] = useState<string | null>(
    null,
  );
  const [editing, setEditing] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [interviewSettingsOpen, setInterviewSettingsOpen] = useState(false);
  const [interviewSettingsMode, setInterviewSettingsMode] = useState<
    "settings" | "create"
  >("create");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const resumeGenerationRef = useRef<{ signature: string; key: string } | null>(
    null,
  );

  const fetchResumes = useCallback(async () => {
    try {
      const res = await fetch("/api/resumes");
      if (res.ok) {
        const data = (await res.json()) as Resume[];
        setResumes(data);
        const hasSelectedResume = selectedResumeId
          ? data.some((resume: Resume) => resume.id === selectedResumeId)
          : false;
        if (data.length > 0 && !hasSelectedResume) {
          const first = data[0];
          setSelectedResumeId(first.id);
          setExpandedFolders(new Set([first.id]));
          if (first.versions.length > 0) {
            setSelectedVersionId(first.versions[0].id);
          }
        }
      }
    } catch (e) {
      console.error("Failed to fetch resumes:", e);
    } finally {
      setLoading(false);
    }
  }, [selectedResumeId]);

  useEffect(() => {
    fetchResumes();
  }, [fetchResumes]);

  useEffect(() => {
    let mounted = true;
    const fetchSession = async () => {
      try {
        const res = await fetch("/api/auth/session");
        if (!res.ok) return;
        const data = (await res.json()) as { user?: UserAvatarMenuUser | null };
        if (mounted) {
          setCurrentUser(data.user ?? null);
        }
      } catch {
        if (mounted) {
          setCurrentUser(null);
        }
      }
    };
    void fetchSession();
    return () => {
      mounted = false;
    };
  }, []);

  const resetNewResumeDialog = () => {
    setNewResumeMode("upload");
    setUploadTitle("");
    setSelectedFile(null);
    setDragOver(false);
    setUploadError(null);
    setGeneratedDraft(EMPTY_GENERATED_DRAFT);
    setGenerateError(null);
    resumeGenerationRef.current = null;
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleNewResumeOpenChange = (open: boolean) => {
    if (!open && (uploading || generating)) return;
    setUploadOpen(open);
    if (!open) resetNewResumeDialog();
  };

  const openNewResumeWithMode = (mode: NewResumeMode) => {
    setNewResumeMode(mode);
    setUploadOpen(true);
  };

  const handleUpload = async () => {
    if (!selectedFile) return;
    setUploading(true);
    setUploadError(null);

    const formData = new FormData();
    formData.append("file", selectedFile);
    formData.append(
      "title",
      uploadTitle || selectedFile.name.replace(/\.[^/.]+$/, ""),
    );

    try {
      const res = await fetch("/api/resumes/upload", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        setUploadError(data.error || "Upload failed");
        return;
      }

      if (
        data.status === "extraction_failed" ||
        data.status === "parse_failed"
      ) {
        setUploadError(data.error || "Processing failed");
      }

      setUploadOpen(false);
      resetNewResumeDialog();
      setSelectedResumeId(data.id);
      setSelectedVersionId(data.versionId);
      setExpandedFolders((prev) => new Set([...prev, data.id]));
      await fetchResumes();
    } catch {
      setUploadError("Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  };

  const handleGenerateResume = async () => {
    if (generating) return;

    const signature = JSON.stringify({
      locale,
      name: generatedDraft.name,
      targetRole: generatedDraft.targetRole,
      coreSkills: generatedDraft.coreSkills,
      education: generatedDraft.education,
      workExperience: generatedDraft.workExperience,
      additionalInfo: generatedDraft.additionalInfo,
    });
    if (resumeGenerationRef.current?.signature !== signature) {
      resumeGenerationRef.current = {
        signature,
        key: crypto.randomUUID(),
      };
    }

    setGenerating(true);
    setGenerateError(null);
    try {
      const response = await fetch("/api/resumes/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: resumeGenerationRef.current.key,
          locale,
          ...generatedDraft,
        }),
      });
      const data = (await response.json().catch(() => null)) as {
        id?: string;
        versionId?: string;
      } | null;

      if (!response.ok || !data?.id || !data.versionId) {
        setGenerateError(t.dashboard.generator.requestFailed);
        return;
      }

      resumeGenerationRef.current = null;
      setUploadOpen(false);
      setSelectedResumeId(data.id);
      setSelectedVersionId(data.versionId);
      setExpandedFolders((previous) => new Set([...previous, data.id!]));
      setPreviewMode("parsed");
      resetNewResumeDialog();
      await fetchResumes();
    } catch {
      setGenerateError(t.dashboard.generator.requestFailed);
    } finally {
      setGenerating(false);
    }
  };

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type === "application/pdf") {
      setSelectedFile(file);
      if (!uploadTitle) setUploadTitle(file.name.replace(/\.[^/.]+$/, ""));
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      if (!uploadTitle) setUploadTitle(file.name.replace(/\.[^/.]+$/, ""));
    }
  };

  const handleDeleteResume = async (resumeId: string) => {
    setDeletingResumeId(resumeId);
    try {
      const res = await fetch(`/api/resumes/${resumeId}`, { method: "DELETE" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setErrorAlertMessage(data?.error ?? "Failed to delete resume.");
        return;
      }

      if (selectedResumeId === resumeId) {
        setSelectedResumeId(null);
        setSelectedVersionId(null);
      }
      setExpandedFolders((prev) => {
        const next = new Set(prev);
        next.delete(resumeId);
        return next;
      });
      await fetchResumes();
    } catch (e) {
      console.error("Failed to delete resume:", e);
      setErrorAlertMessage("Failed to delete resume. Please try again.");
    } finally {
      setDeletingResumeId(null);
      setPendingDeleteResume(null);
    }
  };

  const handleOpenSettings = () => {
    if (!selectedVersion || selectedVersion.parseStatus !== "parsed" || !parsed) {
      toast.error(t.dashboard.resumeNotReady);
      return;
    }
    setInterviewSettingsMode("settings");
    setInterviewSettingsOpen(true);
  };

  const handleStartInterview = () => {
    if (!selectedVersion || selectedVersion.parseStatus !== "parsed" || !parsed) {
      toast.error(t.dashboard.resumeNotReady);
      return;
    }
    setInterviewSettingsMode("create");
    setInterviewSettingsOpen(true);
  };

  const handleSettingsSaved = (saved: ResumeInterviewSettings) => {
    if (!selectedResumeId) return;
    setResumes((prev) =>
      prev.map((r) =>
        r.id === selectedResumeId ? { ...r, interviewSettings: saved } : r,
      ),
    );
  };

  const handleRetryParse = async () => {
    if (!selectedResumeId || !selectedVersion) return;
    if (retryingVersionId === selectedVersion.id) return;

    setRetryingVersionId(selectedVersion.id);
    try {
      const res = await fetch(
        `/api/resumes/${selectedResumeId}/versions/${selectedVersion.id}/reparse`,
        { method: "POST" },
      );
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setErrorAlertMessage(data?.error ?? "Failed to re-parse resume.");
        return;
      }

      await fetchResumes();
    } catch (e) {
      console.error("Failed to re-parse resume:", e);
      setErrorAlertMessage("Failed to re-parse resume. Please try again.");
    } finally {
      setRetryingVersionId(null);
    }
  };

  const handleSaveEdit = async (data: ParsedResume) => {
    if (!selectedResumeId || !selectedVersion) return;
    setSavingEdit(true);
    try {
      const res = await fetch(
        `/api/resumes/${selectedResumeId}/versions/${selectedVersion.id}/edit`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ parsedJson: data }),
        },
      );
      const result = await res.json().catch(() => null);
      if (!res.ok) {
        setErrorAlertMessage(result?.error ?? "Failed to save resume changes.");
        return;
      }
      setEditing(false);
      setSelectedVersionId(result.id);
      await fetchResumes();
    } catch (e) {
      console.error("Failed to save resume edit:", e);
      setErrorAlertMessage("Failed to save resume changes. Please try again.");
    } finally {
      setSavingEdit(false);
    }
  };

  const toggleFolder = (resumeId: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(resumeId)) next.delete(resumeId);
      else next.add(resumeId);
      return next;
    });
  };

  const selectVersion = (resumeId: string, versionId: string) => {
    setSelectedResumeId(resumeId);
    setSelectedVersionId(versionId);
    setEditing(false);
  };

  const selectedResume = resumes.find((r) => r.id === selectedResumeId);
  const selectedVersion = selectedResume?.versions.find(
    (v) => v.id === selectedVersionId,
  );
  const parsed = selectedVersion?.parsedData;
  const hasParsedPreview =
    selectedVersion?.parseStatus === "parsed" && Boolean(parsed);
  const hasOriginalPreview = Boolean(selectedVersion?.originalFileUrl);
  const activePreviewMode =
    previewMode === "parsed" && hasParsedPreview ? "parsed" : "original";

  useEffect(() => {
    if (!selectedVersion) {
      setPreviewMode("parsed");
      return;
    }

    if (selectedVersion.parseStatus === "failed" || !hasParsedPreview) {
      setPreviewMode("original");
      return;
    }

    setPreviewMode("parsed");
  }, [hasParsedPreview, selectedVersion]);

  const parseFailureHint = (() => {
    const error = selectedVersion?.parseError?.toLowerCase() ?? "";
    if (!error) return "";
    if (
      error.includes("incorrect api key") ||
      error.includes("invalid x-api-key") ||
      error.includes("authentication")
    ) {
      return t.dashboard.parseHints.invalidKey;
    }
    if (error.includes("not found")) {
      return t.dashboard.parseHints.notFound;
    }
    if (error.includes("rate limit") || error.includes("速率限制")) {
      return t.dashboard.parseHints.rateLimit;
    }
    if (error.includes("text extraction failed")) {
      return t.dashboard.parseHints.textExtraction;
    }
    return "";
  })();

  return (
    <div className="flex h-screen min-h-0 overflow-hidden bg-background">
      <ResumeSidebar
        loading={loading}
        resumes={resumes}
        expandedFolders={expandedFolders}
        selectedVersionId={selectedVersionId}
        deletingResumeId={deletingResumeId}
        currentUser={currentUser}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((prev) => !prev)}
        onToggleFolder={toggleFolder}
        onSelectVersion={selectVersion}
        onRequestDelete={setPendingDeleteResume}
        onOpenUpload={() => setUploadOpen(true)}
      />

      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {selectedVersion ? (
            <ResumePreviewPane
              selectedResumeId={selectedResumeId ?? undefined}
              selectedResumeTitle={selectedResume?.title}
              selectedVersion={selectedVersion}
              parsed={parsed}
              activePreviewMode={activePreviewMode}
              hasParsedPreview={hasParsedPreview}
              hasOriginalPreview={hasOriginalPreview}
              parseFailureHint={parseFailureHint}
              retryingParse={retryingVersionId === selectedVersion.id}
              hasSavedSettings={Boolean(selectedResume?.interviewSettings)}
              onPreviewModeChange={setPreviewMode}
              onRetryParse={handleRetryParse}
              onOpenSettings={handleOpenSettings}
              onStartInterview={handleStartInterview}
              editing={editing}
              savingEdit={savingEdit}
              onStartEdit={() => setEditing(true)}
              onCancelEdit={() => setEditing(false)}
              onSaveEdit={handleSaveEdit}
            />
          ) : loading ? (
            <div className="flex flex-1 items-center justify-center">
              <div className="text-center space-y-3">
                <Loader2 className="mx-auto size-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">
                  {t.common.loading}
                </p>
              </div>
            </div>
          ) : (
            /* Bento Grid Onboarding Canvas when no resume is selected */
            <div className="flex flex-1 items-center justify-center overflow-y-auto p-6 md:p-12">
              <div className="mx-auto w-full max-w-4xl space-y-8">
                {/* Hero Header */}
                <div className="text-center space-y-2.5 max-w-xl mx-auto">
                  <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/8 px-3 py-1 text-xs font-semibold text-primary">
                    <Sparkles className="size-3.5" />
                    <span>Seconda AI Interview</span>
                  </div>
                  <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground font-sans">
                    {t.dashboard.bento.title}
                  </h1>
                  <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                    {t.dashboard.bento.subtitle}
                  </p>
                </div>

                {/* Bento Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Card 1: Upload PDF */}
                  <div
                    onClick={() => openNewResumeWithMode("upload")}
                    className="group relative flex flex-col justify-between rounded-2xl border border-border/80 bg-card p-6 transition-all duration-200 hover:border-primary/50 hover:shadow-md cursor-pointer"
                  >
                    <div className="space-y-3">
                      <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary transition-transform group-hover:scale-105">
                        <Upload className="size-5" />
                      </div>
                      <div>
                        <h3 className="text-base font-bold text-foreground group-hover:text-primary transition-colors">
                          {t.dashboard.bento.uploadCardTitle}
                        </h3>
                        <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                          {t.dashboard.bento.uploadCardDesc}
                        </p>
                      </div>
                    </div>

                    <div className="mt-6 flex items-center justify-between border-t border-border/60 pt-4">
                      <span className="text-xs font-semibold text-primary">
                        {t.dashboard.bento.uploadCardAction} →
                      </span>
                      <span className="font-mono text-[10px] text-muted-foreground bg-muted/60 px-2 py-0.5 rounded">
                        PDF max 10MB
                      </span>
                    </div>
                  </div>

                  {/* Card 2: AI Generate */}
                  <div
                    onClick={() => openNewResumeWithMode("generate")}
                    className="group relative flex flex-col justify-between rounded-2xl border border-border/80 bg-card p-6 transition-all duration-200 hover:border-primary/50 hover:shadow-md cursor-pointer"
                  >
                    <div className="space-y-3">
                      <div className="flex size-11 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 transition-transform group-hover:scale-105">
                        <Sparkles className="size-5" />
                      </div>
                      <div>
                        <h3 className="text-base font-bold text-foreground group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors">
                          {t.dashboard.bento.generateCardTitle}
                        </h3>
                        <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                          {t.dashboard.bento.generateCardDesc}
                        </p>
                      </div>
                    </div>

                    <div className="mt-6 flex items-center justify-between border-t border-border/60 pt-4">
                      <span className="text-xs font-semibold text-amber-600 dark:text-amber-400">
                        {t.dashboard.bento.generateCardAction} →
                      </span>
                      <span className="font-mono text-[10px] text-muted-foreground bg-muted/60 px-2 py-0.5 rounded">
                        No PDF needed
                      </span>
                    </div>
                  </div>

                  {/* Feature Highlights Wide Card */}
                  <div className="md:col-span-2 rounded-2xl border border-border/70 bg-card/60 p-6 backdrop-blur-xs">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                      <div className="flex items-start gap-3">
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                          <Award className="size-4" />
                        </div>
                        <div>
                          <h4 className="text-xs sm:text-sm font-bold text-foreground">
                            {t.dashboard.bento.feature1Title}
                          </h4>
                          <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
                            {t.dashboard.bento.feature1Desc}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-start gap-3">
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                          <Briefcase className="size-4" />
                        </div>
                        <div>
                          <h4 className="text-xs sm:text-sm font-bold text-foreground">
                            {t.dashboard.bento.feature2Title}
                          </h4>
                          <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
                            {t.dashboard.bento.feature2Desc}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      <NewResumeDialog
        open={uploadOpen}
        onOpenChange={handleNewResumeOpenChange}
        mode={newResumeMode}
        onModeChange={setNewResumeMode}
        uploadTitle={uploadTitle}
        onUploadTitleChange={setUploadTitle}
        dragOver={dragOver}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleFileDrop}
        fileInputRef={fileInputRef}
        onFileSelect={handleFileSelect}
        selectedFile={selectedFile}
        onClearFile={() => setSelectedFile(null)}
        uploadError={uploadError}
        uploading={uploading}
        onUpload={handleUpload}
        generatedDraft={generatedDraft}
        onGeneratedDraftChange={(draft) => {
          setGeneratedDraft(draft);
          setGenerateError(null);
        }}
        generating={generating}
        generateError={generateError}
        onGenerate={handleGenerateResume}
      />

      <DeleteResumeDialog
        pendingDeleteResume={pendingDeleteResume}
        deletingResumeId={deletingResumeId}
        onOpenChange={(open) => {
          if (!open && !deletingResumeId) {
            setPendingDeleteResume(null);
          }
        }}
        onConfirm={(resumeId) => {
          void handleDeleteResume(resumeId);
        }}
      />

      <ErrorAlertDialog
        message={errorAlertMessage}
        onOpenChange={(open) => {
          if (!open) {
            setErrorAlertMessage(null);
          }
        }}
      />

      {selectedResumeId && selectedVersion && parsed ? (
        <InterviewSettingsDialog
          key={`${selectedResumeId}-${selectedVersion.id}-${interviewSettingsMode}`}
          open={interviewSettingsOpen}
          onOpenChange={setInterviewSettingsOpen}
          mode={interviewSettingsMode}
          resumeId={selectedResumeId}
          resumeVersionId={selectedVersion.id}
          defaultTargetRole={parsed.title || selectedResume?.title || ""}
          savedSettings={selectedResume?.interviewSettings}
          onSettingsSaved={handleSettingsSaved}
          onSwitchToSettings={() => setInterviewSettingsMode("settings")}
        />
      ) : null}
    </div>
  );
}

