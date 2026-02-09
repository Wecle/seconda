"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  FileText,
  ChevronRight,
  ChevronDown,
  FolderOpen,
  Folder,
  Upload,
  Trash2,
  Mail,
  Phone,
  MapPin,
  Link as LinkIcon,
  Settings,
  CheckCircle,
  ExternalLink,
  Loader2,
  AlertCircle,
  X,
  FileUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ParsedResume {
  name: string;
  title: string;
  summary?: string;
  contact?: {
    email?: string;
    phone?: string;
    location?: string;
    linkedin?: string;
    website?: string;
  };
  skills: string[];
  experience: {
    title: string;
    company: string;
    period: string;
    bullets: string[];
  }[];
  education?: {
    degree: string;
    school: string;
    period?: string;
  }[];
  projects?: {
    name: string;
    description: string;
    tags?: string[];
  }[];
}

interface ResumeVersion {
  id: string;
  versionNumber: number;
  originalFilename: string;
  parseStatus: string;
  parseError?: string | null;
  parsedData: ParsedResume | null;
  createdAt: string;
}

interface Resume {
  id: string;
  title: string;
  currentVersionId: string | null;
  createdAt: string;
  updatedAt: string;
  versions: ResumeVersion[];
}

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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchResumes = useCallback(async () => {
    try {
      const res = await fetch("/api/resumes");
      if (res.ok) {
        const data = await res.json();
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

      await fetchResumes();
    } catch (e) {
      console.error("Failed to delete resume:", e);
      window.alert("Failed to delete resume. Please try again.");
    } finally {
      setDeletingResumeId(null);
      setPendingDeleteResume(null);
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

  const parseFailureHint = (() => {
    const error = selectedVersion?.parseError?.toLowerCase() ?? "";
    if (!error) return "";
    if (error.includes("incorrect api key")) {
      return "OPENAI_API_KEY 无效，请更新 .env 后重启服务。";
    }
    if (error.includes("not found")) {
      return "BASE_MODEL 或 BASE_URL 不可用，请检查模型名和接口地址。";
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
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Left Sidebar */}
      <aside className="flex w-72 shrink-0 flex-col border-r bg-card">
        <Link href="/" className="flex items-center gap-2.5 px-5 py-4">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary">
            <FileText className="size-4 text-primary-foreground" />
          </div>
          <div>
            <p className="text-sm font-semibold">Resume AI</p>
            <p className="text-xs text-muted-foreground">Dashboard</p>
          </div>
        </Link>

        <Separator />

        <ScrollArea className="flex-1">
          <div className="p-3">
            <p className="mb-2 px-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Resumes
            </p>

            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : resumes.length === 0 ? (
              <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                No resumes yet. Upload one to get started.
              </p>
            ) : (
              resumes.map((resume) => {
                const isExpanded = expandedFolders.has(resume.id);
                return (
                  <div key={resume.id} className="mb-1">
                    <div className="group flex items-center gap-0.5 rounded-md hover:bg-accent/50 pr-1 transition-colors">
                      <button
                        onClick={() => toggleFolder(resume.id)}
                        className="flex min-w-0 flex-1 items-center gap-2 rounded-l-md px-2 py-1.5 text-sm font-medium outline-none"
                      >
                        {isExpanded ? (
                          <ChevronDown className="size-3.5 text-muted-foreground/70" />
                        ) : (
                          <ChevronRight className="size-3.5 text-muted-foreground/70" />
                        )}
                        {isExpanded ? (
                          <FolderOpen className="size-4 text-primary" />
                        ) : (
                          <Folder className="size-4 text-muted-foreground" />
                        )}
                        <span className="truncate">{resume.title}</span>
                      </button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="size-7 shrink-0 opacity-0 transition-opacity hover:bg-transparent hover:text-destructive group-hover:opacity-100"
                        disabled={deletingResumeId === resume.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          setPendingDeleteResume({
                            id: resume.id,
                            title: resume.title,
                          });
                        }}
                        aria-label={`Delete ${resume.title}`}
                      >
                        {deletingResumeId === resume.id ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="size-3.5" />
                        )}
                      </Button>
                    </div>

                    {isExpanded && (
                      <div className="ml-5 border-l pl-3">
                        {resume.versions.map((v) => {
                          const isActive = v.id === selectedVersionId;
                          return (
                            <button
                              key={v.id}
                              onClick={() => selectVersion(resume.id, v.id)}
                              className={cn(
                                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                                isActive
                                  ? "bg-primary/10 font-medium text-primary"
                                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
                              )}
                            >
                              <FileText className="size-3.5" />
                              <span>v{v.versionNumber}</span>
                              {v.id === resume.currentVersionId && (
                                <Badge
                                  variant="default"
                                  className="ml-auto text-[10px] px-1.5 py-0"
                                >
                                  Current
                                </Badge>
                              )}
                              {v.parseStatus === "failed" && (
                                <AlertCircle className="ml-2 size-3.5 text-destructive" />
                              )}
                              {v.parseStatus === "parsing" && (
                                <Loader2 className="ml-2 size-3.5 animate-spin" />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </ScrollArea>

        <Separator />

        <div className="p-3">
          <Button
            className="w-full"
            size="sm"
            onClick={() => setUploadOpen(true)}
          >
            <Upload className="size-4" />
            Upload New Resume
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="relative flex flex-1 flex-col overflow-hidden">
        {parsed ? (
          <>
            {/* Top Nav */}
            <header className="flex items-center justify-between border-b bg-card px-6 py-3">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Resumes</span>
                <ChevronRight className="size-3.5 text-muted-foreground" />
                <span className="text-muted-foreground">
                  {selectedResume?.title}
                </span>
                <ChevronRight className="size-3.5 text-muted-foreground" />
                <span className="font-medium">
                  v{selectedVersion?.versionNumber}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {selectedVersion?.parseStatus === "parsed" && (
                  <Badge
                    variant="secondary"
                    className="gap-1 bg-emerald-50 text-emerald-700"
                  >
                    <CheckCircle className="size-3" />
                    Parsed Successfully
                  </Badge>
                )}
              </div>
            </header>

            {/* Scrollable Content */}
            <ScrollArea className="flex-1">
              <div className="flex justify-center px-8 py-8 pb-24">
                <div className="w-full max-w-[850px] space-y-6">
                  {/* Resume Header */}
                  <div className="rounded-xl border bg-card p-8">
                    <div className="flex items-start justify-between">
                      <div>
                        <h1 className="text-2xl font-bold">{parsed.name}</h1>
                        <p className="mt-1 text-lg font-medium text-primary">
                          {parsed.title}
                        </p>
                        {parsed.summary && (
                          <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted-foreground">
                            {parsed.summary}
                          </p>
                        )}
                      </div>
                      {parsed.contact && (
                        <div className="flex flex-col items-end gap-1.5 text-sm text-muted-foreground">
                          {parsed.contact.email && (
                            <span className="inline-flex items-center gap-1.5">
                              <Mail className="size-3.5" />
                              {parsed.contact.email}
                            </span>
                          )}
                          {parsed.contact.phone && (
                            <span className="inline-flex items-center gap-1.5">
                              <Phone className="size-3.5" />
                              {parsed.contact.phone}
                            </span>
                          )}
                          {parsed.contact.location && (
                            <span className="inline-flex items-center gap-1.5">
                              <MapPin className="size-3.5" />
                              {parsed.contact.location}
                            </span>
                          )}
                          {parsed.contact.linkedin && (
                            <span className="inline-flex items-center gap-1.5">
                              <LinkIcon className="size-3.5" />
                              {parsed.contact.linkedin}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Skills */}
                  {parsed.skills.length > 0 && (
                    <div className="rounded-xl border bg-card p-8">
                      <h2 className="mb-4 text-base font-semibold">Skills</h2>
                      <div className="flex flex-wrap gap-2">
                        {parsed.skills.map((skill) => (
                          <span
                            key={skill}
                            className="rounded-md bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary"
                          >
                            {skill}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Experience */}
                  {parsed.experience.length > 0 && (
                    <div className="rounded-xl border bg-card p-8">
                      <h2 className="mb-6 text-base font-semibold">
                        Experience
                      </h2>
                      <div className="space-y-8">
                        {parsed.experience.map((job, i) => (
                          <div key={i} className="relative pl-6">
                            <div className="absolute left-0 top-1.5 size-2.5 rounded-full bg-primary" />
                            {i < parsed.experience.length - 1 && (
                              <div className="absolute left-[4.5px] top-4 h-[calc(100%+16px)] w-px bg-border" />
                            )}
                            <div className="flex items-baseline justify-between">
                              <div>
                                <h3 className="text-sm font-semibold">
                                  {job.title}
                                </h3>
                                <p className="text-sm text-primary">
                                  {job.company}
                                </p>
                              </div>
                              <span className="text-xs text-muted-foreground">
                                {job.period}
                              </span>
                            </div>
                            <ul className="mt-2 space-y-1.5">
                              {job.bullets.map((b, j) => (
                                <li
                                  key={j}
                                  className="text-sm leading-relaxed text-muted-foreground"
                                >
                                  • {b}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Education */}
                  {parsed.education && parsed.education.length > 0 && (
                    <div className="rounded-xl border bg-card p-8">
                      <h2 className="mb-4 text-base font-semibold">
                        Education
                      </h2>
                      <div className="space-y-4">
                        {parsed.education.map((edu, i) => (
                          <div key={i}>
                            <h3 className="text-sm font-semibold">
                              {edu.degree}
                            </h3>
                            <p className="text-sm text-primary">{edu.school}</p>
                            {edu.period && (
                              <p className="text-xs text-muted-foreground">
                                {edu.period}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Projects */}
                  {parsed.projects && parsed.projects.length > 0 && (
                    <div className="rounded-xl border bg-card p-8">
                      <h2 className="mb-4 text-base font-semibold">Projects</h2>
                      <div className="grid grid-cols-2 gap-4">
                        {parsed.projects.map((project) => (
                          <div
                            key={project.name}
                            className="rounded-lg border bg-background p-5"
                          >
                            <div className="flex items-center gap-1.5">
                              <h3 className="text-sm font-semibold">
                                {project.name}
                              </h3>
                              <ExternalLink className="size-3.5 text-muted-foreground" />
                            </div>
                            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                              {project.description}
                            </p>
                            {project.tags && project.tags.length > 0 && (
                              <div className="mt-3 flex flex-wrap gap-1.5">
                                {project.tags.map((tag) => (
                                  <span
                                    key={tag}
                                    className="rounded bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground"
                                  >
                                    {tag}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </ScrollArea>

            {/* Floating Action Bar */}
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-between border-t bg-card/95 px-6 py-3 backdrop-blur-sm">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <FileText className="size-4" />
                <span>
                  {selectedResume?.title} —{" "}
                  <span className="font-medium text-foreground">
                    v{selectedVersion?.versionNumber}
                  </span>
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="icon-sm">
                  <Settings className="size-4" />
                </Button>
                <Button
                  size="sm"
                  onClick={() =>
                    router.push(
                      `/interviews/new?resumeVersionId=${selectedVersion?.id}`,
                    )
                  }
                >
                  Start Interview with this Version
                </Button>
              </div>
            </div>
          </>
        ) : selectedVersion?.parseStatus === "failed" ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="max-w-xl space-y-3 text-center">
              <AlertCircle className="mx-auto size-12 text-destructive/50" />
              <h2 className="text-lg font-semibold">Parsing Failed</h2>
              <p className="mx-auto max-w-md text-sm text-muted-foreground">
                We couldn&apos;t parse this resume. Please try uploading a
                different PDF file.
              </p>
              {selectedVersion?.parseError && (
                <div className="rounded-md border bg-muted/40 p-3 text-left">
                  <p className="text-xs font-medium text-muted-foreground">
                    Error Details
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-foreground">
                    {selectedVersion.parseError}
                  </p>
                </div>
              )}
              {parseFailureHint && (
                <p className="text-xs text-muted-foreground">
                  {parseFailureHint}
                </p>
              )}
            </div>
          </div>
        ) : loading ||
          (selectedVersion && selectedVersion.parseStatus !== "parsed") ? (
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

      {/* Upload Dialog */}
      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Upload Resume</DialogTitle>
            <DialogDescription>
              Upload a PDF resume. It will be automatically parsed by AI.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="title">Resume Title</Label>
              <Input
                id="title"
                value={uploadTitle}
                onChange={(e) => setUploadTitle(e.target.value)}
                placeholder="e.g. Frontend Developer"
              />
            </div>

            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleFileDrop}
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                "flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors",
                dragOver
                  ? "border-primary bg-primary/5"
                  : "border-muted-foreground/25 hover:border-primary/50",
              )}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf"
                onChange={handleFileSelect}
                className="hidden"
              />
              {selectedFile ? (
                <div className="flex items-center gap-3">
                  <FileText className="size-8 text-primary" />
                  <div>
                    <p className="text-sm font-medium">{selectedFile.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedFile(null);
                    }}
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              ) : (
                <>
                  <Upload className="size-8 text-muted-foreground/50" />
                  <p className="mt-2 text-sm font-medium">
                    Drop PDF here or click to browse
                  </p>
                  <p className="text-xs text-muted-foreground">
                    PDF up to 10MB
                  </p>
                </>
              )}
            </div>

            {uploadError && (
              <div className="flex items-center gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircle className="size-4 shrink-0" />
                {uploadError}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setUploadOpen(false)}
                disabled={uploading}
              >
                Cancel
              </Button>
              <Button
                onClick={handleUpload}
                disabled={!selectedFile || uploading}
              >
                {uploading ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Upload className="size-4" />
                    Upload &amp; Parse
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(pendingDeleteResume)}
        onOpenChange={(open) => {
          if (!open && !deletingResumeId) {
            setPendingDeleteResume(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Resume?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDeleteResume
                ? `Are you sure you want to delete "${pendingDeleteResume.title}"? This will also delete its versions and related interviews. This action cannot be undone.`
                : "This action cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(deletingResumeId)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20"
              disabled={
                !pendingDeleteResume ||
                deletingResumeId === pendingDeleteResume.id
              }
              onClick={(event) => {
                event.preventDefault();
                if (!pendingDeleteResume) return;
                void handleDeleteResume(pendingDeleteResume.id);
              }}
            >
              {pendingDeleteResume &&
              deletingResumeId === pendingDeleteResume.id ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
