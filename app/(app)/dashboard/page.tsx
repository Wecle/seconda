"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { FileUp, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  defaultInterviewConfig,
  type InterviewConfig,
} from "@/lib/interview/settings";
import { DeleteResumeDialog } from "@/components/dashboard/delete-resume-dialog";
import { InterviewSettingsDialog } from "@/components/dashboard/interview-settings-dialog";
import { ResumePreviewPane } from "@/components/dashboard/resume-preview-pane";
import { ResumeSidebar } from "@/components/dashboard/resume-sidebar";
import type { Resume } from "@/components/dashboard/types";
import { UploadResumeDialog } from "@/components/dashboard/upload-resume-dialog";

export default function DashboardPage() {
  const router = useRouter();
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
        window.alert(data?.error ?? "Failed to delete resume.");
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
      window.alert("Failed to delete resume. Please try again.");
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
        window.alert(data?.error ?? "Failed to save interview settings.");
        return;
      }

      setInterviewConfigByResumeId((prev) => ({
        ...prev,
        [selectedResumeId]: data.interviewSettings as InterviewConfig,
      }));
      setSettingsOpen(false);
    } catch (e) {
      console.error("Failed to save interview settings:", e);
      window.alert("Failed to save interview settings. Please try again.");
    } finally {
      setSavingInterviewSettings(false);
    }
  };

  const selectedInterviewConfig = selectedResumeId
    ? interviewConfigByResumeId[selectedResumeId] ?? null
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
        window.alert(data?.error ?? "Failed to create interview.");
        return;
      }
      router.push(`/interviews/${data.interviewId}/room`);
    } catch (e) {
      console.error("Failed to start interview:", e);
      window.alert("Failed to create interview. Please try again.");
    } finally {
      setCreatingInterview(false);
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
      return "OPENAI_API_KEY 无效，请更新 .env 后重启服务。";
    }
    if (error.includes("not found")) {
      return "接口返回 Not Found。请检查 BASE_MODEL 和 BASE_URL 是否正确。";
    }
    if (error.includes("rate limit") || error.includes("速率限制")) {
      return "接口触发限流，请稍后重试上传，或降低并发请求频率。";
    }
    if (error.includes("text extraction failed")) {
      return "PDF 文本提取失败，可能是扫描件，请换可复制文本的 PDF。";
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
        onToggleFolder={toggleFolder}
        onSelectVersion={selectVersion}
        onRequestDelete={setPendingDeleteResume}
        onOpenUpload={() => setUploadOpen(true)}
      />

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
            onPreviewModeChange={setPreviewMode}
            selectedInterviewConfig={selectedInterviewConfig}
            creatingInterview={creatingInterview}
            onOpenSettings={openSettingsDialog}
            onStartInterview={handleStartInterview}
          />
        ) : loading ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center space-y-3">
              <Loader2 className="mx-auto size-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Loading...</p>
            </div>
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center space-y-4">
              <FileUp className="mx-auto size-12 text-muted-foreground/30" />
              <div>
                <h2 className="text-lg font-semibold">No resume selected</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Upload a resume to get started
                </p>
              </div>
              <Button onClick={() => setUploadOpen(true)}>
                <Upload className="size-4" />
                Upload Resume
              </Button>
            </div>
          </div>
        )}
      </main>

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
    </div>
  );
}
