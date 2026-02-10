"use client";

import Link from "next/link";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  Loader2,
  Trash2,
  Upload,
} from "lucide-react";
import { BrandIcon } from "@/components/brand/brand-icon";
import type { UserAvatarMenuUser } from "@/components/auth/user-avatar-menu";
import { UserAvatarMenu } from "@/components/auth/user-avatar-menu";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import type { Resume, ResumeVersion } from "@/components/dashboard/types";

interface ResumeSidebarProps {
  loading: boolean;
  resumes: Resume[];
  expandedFolders: Set<string>;
  selectedVersionId: string | null;
  deletingResumeId: string | null;
  currentUser: UserAvatarMenuUser | null;
  onToggleFolder: (resumeId: string) => void;
  onSelectVersion: (resumeId: string, versionId: string) => void;
  onRequestDelete: (resume: { id: string; title: string }) => void;
  onOpenUpload: () => void;
}

export function ResumeSidebar({
  loading,
  resumes,
  expandedFolders,
  selectedVersionId,
  deletingResumeId,
  currentUser,
  onToggleFolder,
  onSelectVersion,
  onRequestDelete,
  onOpenUpload,
}: ResumeSidebarProps) {
  const { t } = useTranslation();
  return (
    <aside className="flex min-h-0 w-72 shrink-0 flex-col border-r bg-card">
      <div className="flex items-center justify-between px-5 py-4">
        <Link href="/" className="flex min-w-0 items-center gap-2.5">
          <BrandIcon size={32} />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">Seconda</p>
            <p className="truncate text-xs text-muted-foreground">Dashboard</p>
          </div>
        </Link>
        {currentUser ? (
          <UserAvatarMenu user={currentUser} avatarSize="sm" />
        ) : (
          <div className="size-6 rounded-full bg-muted" />
        )}
      </div>

      <Separator />

      <ScrollArea className="min-h-0 flex-1">
        <div className="p-3">
          <p className="mb-2 px-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {t.dashboard.resumes}
          </p>

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : resumes.length === 0 ? (
            <p className="px-2 py-4 text-center text-xs text-muted-foreground">
              {t.dashboard.noResumes}
            </p>
          ) : (
            resumes.map((resume) => {
              const isExpanded = expandedFolders.has(resume.id);
              return (
                <div key={resume.id} className="mb-1">
                  <div className="group flex items-center gap-0.5 rounded-md pr-1 transition-colors hover:bg-accent/50">
                    <button
                      onClick={() => onToggleFolder(resume.id)}
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
                        onRequestDelete({ id: resume.id, title: resume.title });
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
                      {resume.versions.map((version: ResumeVersion) => {
                        const isActive = version.id === selectedVersionId;
                        return (
                          <button
                            key={version.id}
                            onClick={() =>
                              onSelectVersion(resume.id, version.id)
                            }
                            className={cn(
                              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 pr-4 text-sm",
                              isActive
                                ? "bg-primary/10 font-medium text-primary"
                                : "text-muted-foreground hover:bg-accent hover:text-foreground",
                            )}
                          >
                            <FileText className="size-3.5" />
                            <span>v{version.versionNumber}</span>
                            {version.id === resume.currentVersionId && (
                              <Badge
                                variant="default"
                                className="ml-auto px-1.5 py-0 text-[10px]"
                              >
                                {t.common.current}
                              </Badge>
                            )}
                            {version.parseStatus === "failed" && (
                              <AlertCircle className="ml-2 size-3.5 text-destructive" />
                            )}
                            {version.parseStatus === "parsing" && (
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
        <Button className="w-full" size="sm" onClick={onOpenUpload}>
          <Upload className="size-4" />
          {t.dashboard.uploadNewResume}
        </Button>
      </div>
    </aside>
  );
}
