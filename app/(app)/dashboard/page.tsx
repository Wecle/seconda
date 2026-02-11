"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { FileUp, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/lib/i18n/context";
import {
  defaultInterviewConfig,
  type InterviewConfig,
} from "@/lib/interview/settings";
import { DeleteResumeDialog } from "@/components/dashboard/delete-resume-dialog";
import { ErrorAlertDialog } from "@/components/dashboard/error-alert-dialog";
import { InterviewSettingsDialog } from "@/components/dashboard/interview-settings-dialog";
import { InterviewHistoryPanel } from "@/components/dashboard/interview-history-panel";
import { ResumePreviewPane } from "@/components/dashboard/resume-preview-pane";
import { ResumeSidebar } from "@/components/dashboard/resume-sidebar";
import type { Resume } from "@/components/dashboard/types";
import type { UserAvatarMenuUser } from "@/components/auth/user-avatar-menu";
import { UploadResumeDialog } from "@/components/dashboard/upload-resume-dialog";
import type { ParsedResume } from "@/lib/resume/types";

export default function DashboardPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const [currentUser, setCurrentUser] = useState<UserAvatarMenuUser | null>(
    null,
  );
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedResumeId, setSelectedResumeId] = useState<string | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(
    null,
  );
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set(),
  );
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draftInterviewConfig, setDraftInterviewConfig] =
    useState<InterviewConfig>(defaultInterviewConfig);
  const [interviewConfigByResumeId, setInterviewConfigByResumeId] = useState<
    Record<string, InterviewConfig>
  >({});
  const [savingInterviewSettings, setSavingInterviewSettings] = useState(false);
  const [creatingInterview, setCreatingInterview] = useState(false);
  const [retryingVersionId, setRetryingVersionId] = useState<string | null>(
    null,
  );
  const [errorAlertMessage, setErrorAlertMessage] = useState<string | null>(
    null,
  );
  const [editing, setEditing] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchResumes = useCallback(async () => {
    try {
      const res = await fetch("/api/resumes");
      if (res.ok) {
        const data = (await res.json()) as Resume[];
        setResumes(data);
        const persistedConfigMap: Record<string, InterviewConfig> = {};
        for (const resume of data) {
          if (resume.interviewSettings) {
            persistedConfigMap[resume.id] = resume.interviewSettings;
          }
        }
        setInterviewConfigByResumeId(persistedConfigMap);
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
      setSelectedFile(null);
      setUploadTitle("");
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
      setInterviewConfigByResumeId((prev) => {
        if (!(resumeId in prev)) return prev;
        const next = { ...prev };
        delete next[resumeId];
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

  const openSettingsDialog = () => {
    if (!selectedResumeId) return;
    setDraftInterviewConfig(
      interviewConfigByResumeId[selectedResumeId] ?? defaultInterviewConfig,
    );
    setSettingsOpen(true);
  };

  const handleSaveInterviewSettings = async () => {
    if (!selectedResumeId) return;
    setSavingInterviewSettings(true);
    try {
      const res = await fetch(`/api/resumes/${selectedResumeId}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draftInterviewConfig),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.interviewSettings) {
        setErrorAlertMessage(data?.error ?? "Failed to save interview settings.");
        return;
      }

      setInterviewConfigByResumeId((prev) => ({
        ...prev,
        [selectedResumeId]: data.interviewSettings as InterviewConfig,
      }));
      setSettingsOpen(false);
    } catch (e) {
      console.error("Failed to save interview settings:", e);
      setErrorAlertMessage("Failed to save interview settings. Please try again.");
    } finally {
      setSavingInterviewSettings(false);
    }
  };

  const selectedInterviewConfig = selectedResumeId
    ? (interviewConfigByResumeId[selectedResumeId] ?? null)
    : null;

  const handleStartInterview = async () => {
    if (!selectedVersion || !selectedInterviewConfig || creatingInterview)
      return;

    setCreatingInterview(true);
    try {
      const res = await fetch("/api/interviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          level: selectedInterviewConfig.level.toLowerCase(),
          type: selectedInterviewConfig.type,
          language: selectedInterviewConfig.language,
          questionCount: selectedInterviewConfig.questionCount,
          persona: selectedInterviewConfig.persona,
          resumeVersionId: selectedVersion.id,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setErrorAlertMessage(data?.error ?? "Failed to create interview.");
        return;
      }
      router.push(`/interviews/${data.interviewId}/room`);
    } catch (e) {
      console.error("Failed to start interview:", e);
      setErrorAlertMessage("Failed to create interview. Please try again.");
    } finally {
      setCreatingInterview(false);
    }
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
  const showInterviewHistoryPanel =
    (selectedVersion?.interviews.length ?? 0) > 0;
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
        onToggleFolder={toggleFolder}
        onSelectVersion={selectVersion}
        onRequestDelete={setPendingDeleteResume}
        onOpenUpload={() => setUploadOpen(true)}
      />

      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {selectedVersion ? (
            <ResumePreviewPane
              selectedResumeTitle={selectedResume?.title}
              selectedVersion={selectedVersion}
              parsed={parsed}
              activePreviewMode={activePreviewMode}
              hasParsedPreview={hasParsedPreview}
              hasOriginalPreview={hasOriginalPreview}
              parseFailureHint={parseFailureHint}
              retryingParse={retryingVersionId === selectedVersion.id}
              onPreviewModeChange={setPreviewMode}
              onRetryParse={handleRetryParse}
              selectedInterviewConfig={selectedInterviewConfig}
              creatingInterview={creatingInterview}
              onOpenSettings={openSettingsDialog}
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
            <div className="flex flex-1 items-center justify-center">
              <div className="text-center space-y-4">
                <FileUp className="mx-auto size-12 text-muted-foreground/30" />
                <div>
                  <h2 className="text-lg font-semibold">
                    {t.dashboard.noResumeSelected}
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t.dashboard.uploadToStart}
                  </p>
                </div>
                <Button onClick={() => setUploadOpen(true)}>
                  <Upload className="size-4" />
                  {t.dashboard.uploadResume}
                </Button>
              </div>
            </div>
          )}
        </main>

        {showInterviewHistoryPanel ? (
          <InterviewHistoryPanel
            selectedResumeTitle={selectedResume?.title}
            selectedVersion={selectedVersion ?? null}
          />
        ) : null}
      </div>

      <InterviewSettingsDialog
        open={settingsOpen}
        saving={savingInterviewSettings}
        value={draftInterviewConfig}
        onOpenChange={(open) => {
          if (!savingInterviewSettings) {
            setSettingsOpen(open);
          }
        }}
        onChange={setDraftInterviewConfig}
        onCancel={() => setSettingsOpen(false)}
        onSave={handleSaveInterviewSettings}
      />

      <UploadResumeDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
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
        onCancel={() => setUploadOpen(false)}
        onUpload={handleUpload}
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
    </div>
  );
}
