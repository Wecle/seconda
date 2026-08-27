"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { BrandIcon } from "@/components/brand/brand-icon";
import type { UserAvatarMenuUser } from "@/components/auth/user-avatar-menu";
import { UserAvatarMenu } from "@/components/auth/user-avatar-menu";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type {
  Resume,
  ResumeVersion,
} from "@/components/dashboard/types";

interface ResumeSidebarProps {
  loading: boolean;
  resumes: Resume[];
  expandedFolders: Set<string>;
  selectedVersionId: string | null;
  deletingResumeId: string | null;
  currentUser: UserAvatarMenuUser | null;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
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
  collapsed = false,
  onToggleCollapse,
  onToggleFolder,
  onSelectVersion,
  onRequestDelete,
  onOpenUpload,
}: ResumeSidebarProps) {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState("");

  const filteredResumes = useMemo(() => {
    if (!searchQuery.trim()) return resumes;
    const query = searchQuery.trim().toLowerCase();
    return resumes.filter((r) => {
      if (r.title.toLowerCase().includes(query)) return true;
      return r.versions.some((v) => {
        const title = v.parsedData?.title?.toLowerCase() ?? "";
        const skills = v.parsedData?.skills?.join(" ").toLowerCase() ?? "";
        return title.includes(query) || skills.includes(query);
      });
    });
  }, [resumes, searchQuery]);

  return (
    <aside
      className={cn(
        "relative flex min-h-0 shrink-0 flex-col border-r bg-card/95 backdrop-blur-sm transition-[width] duration-300 ease-in-out select-none",
        collapsed ? "w-16" : "w-76",
      )}
    >
      {/* Brand & User Header */}
      <div
        className={cn(
          "flex items-center justify-between px-3.5 py-3.5 transition-all duration-300",
          collapsed && "flex-col gap-3.5 px-2 py-3",
        )}
      >
        <Link
          href="/"
          className={cn(
            "flex items-center gap-2.5 group overflow-hidden transition-all duration-300",
            collapsed && "justify-center",
          )}
          aria-label="Seconda Home"
        >
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary transition-transform group-hover:scale-105">
            <BrandIcon size={22} />
          </div>
          {!collapsed && (
            <div className="min-w-0 transition-opacity duration-200">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-sm font-semibold tracking-tight text-foreground">
                  Seconda
                </span>
                <span className="rounded bg-primary/10 px-1 py-0.2 text-[10px] font-mono font-medium text-primary">
                  AI
                </span>
              </div>
              <p className="truncate text-[11px] text-muted-foreground">
                Mock Interview System
              </p>
            </div>
          )}
        </Link>

        <div className={cn("flex items-center gap-1", collapsed && "flex-col gap-2")}>
          {onToggleCollapse && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="size-7 text-muted-foreground hover:text-foreground transition-colors"
                    onClick={onToggleCollapse}
                  >
                    {collapsed ? (
                      <PanelLeftOpen className="size-3.5" />
                    ) : (
                      <PanelLeftClose className="size-3.5" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side={collapsed ? "right" : "bottom"}>
                  {collapsed
                    ? t.dashboard.expandSidebar
                    : t.dashboard.collapseSidebar}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          {currentUser ? (
            <UserAvatarMenu
              user={currentUser}
              avatarSize="sm"
              panelAlign={collapsed ? "right" : "left"}
            />
          ) : (
            <div className="size-6 rounded-full bg-muted" />
          )}
        </div>
      </div>

      <Separator />

      {/* Search / Filter Bar (Animated Collapse) */}
      <div
        className={cn(
          "overflow-hidden transition-all duration-300 ease-in-out",
          collapsed || resumes.length === 0
            ? "max-h-0 opacity-0"
            : "max-h-14 opacity-100 px-3.5 pt-3 pb-1",
        )}
      >
        <div className="relative flex items-center">
          <Search className="absolute left-2.5 size-3.5 text-muted-foreground/60 pointer-events-none" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t.dashboard.searchResumesPlaceholder}
            className="h-8 pl-8 pr-7 text-xs bg-muted/40 border-border/60 focus-visible:bg-background"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-2 text-muted-foreground hover:text-foreground p-0.5 rounded transition-colors"
            >
              <X className="size-3" />
            </button>
          )}
        </div>
      </div>

      {/* Resumes Tree List */}
      <ScrollArea className="min-h-0 flex-1">
        {collapsed ? (
          /* Collapsed Icon-Only View */
          <div className="flex flex-col items-center gap-2 p-2">
            {loading ? (
              <Loader2 className="size-4 animate-spin text-primary my-4" />
            ) : (
              filteredResumes.map((resume) => {
                const isCurrentSelected = resume.versions.some(
                  (v) => v.id === selectedVersionId,
                );
                const firstVersion = resume.versions[0];

                return (
                  <TooltipProvider key={resume.id}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={() => {
                            if (firstVersion) {
                              onSelectVersion(resume.id, firstVersion.id);
                            }
                          }}
                          className={cn(
                            "relative flex size-9 items-center justify-center rounded-xl transition-all duration-150 active:scale-95",
                            isCurrentSelected
                              ? "bg-primary/15 text-primary shadow-xs"
                              : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                          )}
                        >
                          <Folder className="size-4" />
                          {resume.versions.length > 1 && (
                            <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-primary" />
                          )}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="right">
                        <p className="font-medium text-xs">{resume.title}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {resume.versions.length} {t.dashboard.versionsCount}
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                );
              })
            )}
          </div>
        ) : (
          /* Expanded Tree View */
          <div className="px-3.5 py-3 pr-3.5">
            <div className="mb-2 flex items-center justify-between px-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
                {t.dashboard.resumes}
              </span>
              {resumes.length > 0 && (
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-mono font-medium text-muted-foreground">
                  {resumes.length}
                </span>
              )}
            </div>

            {loading ? (
              <div className="flex flex-col items-center justify-center py-10 space-y-2">
                <Loader2 className="size-5 animate-spin text-primary" />
                <span className="text-xs text-muted-foreground">
                  {t.common.loading}
                </span>
              </div>
            ) : resumes.length === 0 ? (
              <div className="rounded-lg border border-dashed p-4 text-center">
                <p className="text-xs text-muted-foreground">
                  {t.dashboard.noResumes}
                </p>
              </div>
            ) : filteredResumes.length === 0 ? (
              <div className="py-6 text-center text-xs text-muted-foreground">
                {t.dashboard.filterNoResults}
              </div>
            ) : (
              filteredResumes.map((resume) => {
                const isExpanded = expandedFolders.has(resume.id);
                const latestVersion = resume.versions[0];
                const isCurrentSelected = resume.versions.some(
                  (v) => v.id === selectedVersionId,
                );

                return (
                  <div key={resume.id} className="mb-1">
                    <div
                      className={cn(
                        "group flex items-center gap-0.5 rounded-lg pr-1 transition-all duration-150",
                        isCurrentSelected
                          ? "bg-accent/70 font-medium text-foreground"
                          : "hover:bg-accent/40 text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <button
                        onClick={() => onToggleFolder(resume.id)}
                        className="flex min-w-0 flex-1 items-center gap-2 rounded-l-lg px-2 py-1.5 text-xs outline-none"
                      >
                        <ChevronRight
                          className={cn(
                            "size-3.5 text-muted-foreground/70 transition-transform duration-200 ease-out shrink-0",
                            isExpanded && "rotate-90 text-primary",
                          )}
                        />
                        {isExpanded ? (
                          <FolderOpen className="size-4 text-primary shrink-0 transition-colors" />
                        ) : (
                          <Folder className="size-4 text-muted-foreground shrink-0 transition-colors" />
                        )}
                        <span className="truncate font-medium text-left">
                          {resume.title}
                        </span>
                        {latestVersion && (
                          <span className="ml-auto shrink-0 rounded bg-muted/60 px-1.5 py-0.5 text-[9px] font-mono text-muted-foreground">
                            v{resume.versions.length}
                          </span>
                        )}
                      </button>

                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        className="size-6 shrink-0 opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                        disabled={deletingResumeId === resume.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          onRequestDelete({ id: resume.id, title: resume.title });
                        }}
                        aria-label={`Delete ${resume.title}`}
                      >
                        {deletingResumeId === resume.id ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <Trash2 className="size-3" />
                        )}
                      </Button>
                    </div>

                    {/* Smooth Height Animated Sub-Tree via CSS Grid */}
                    <div
                      className={cn(
                        "grid transition-all duration-200 ease-out overflow-hidden",
                        isExpanded
                          ? "grid-rows-[1fr] opacity-100 mt-1"
                          : "grid-rows-[0fr] opacity-0 mt-0",
                      )}
                    >
                      <div className="min-h-0 overflow-hidden ml-5 mr-1 space-y-0.5 border-l border-border/60 pl-2.5">
                        {resume.versions.map((version: ResumeVersion) => {
                          const isActive = version.id === selectedVersionId;
                          const isAi = version.sourceType === "generated";

                          return (
                            <div key={version.id}>
                              <button
                                onClick={() =>
                                  onSelectVersion(resume.id, version.id)
                                }
                                className={cn(
                                  "flex w-full items-center justify-between gap-1.5 rounded-md px-2 py-1.5 text-xs transition-all duration-150",
                                  isActive
                                    ? "bg-primary/10 font-semibold text-primary shadow-xs"
                                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                                )}
                              >
                                <div className="flex items-center gap-1.5 min-w-0">
                                  {isAi ? (
                                    <Sparkles className="size-3 text-amber-500 shrink-0" />
                                  ) : (
                                    <FileText className="size-3 shrink-0 opacity-70" />
                                  )}
                                  <span className="font-mono">
                                    v{version.versionNumber}
                                  </span>
                                </div>

                                <div className="flex items-center gap-1.5 shrink-0 pl-0.5">
                                  {version.id === resume.currentVersionId && (
                                    <Badge
                                      variant="secondary"
                                      className="h-4 px-1 text-[9px] font-mono leading-none bg-primary/15 text-primary border-0"
                                    >
                                      {t.common.current}
                                    </Badge>
                                  )}

                                  {version.parseStatus === "parsed" && (
                                    <span
                                      className="size-1.5 rounded-full bg-emerald-500 shrink-0 ring-2 ring-emerald-500/20"
                                      title={t.dashboard.parsedSuccessfully}
                                    />
                                  )}

                                  {version.parseStatus === "failed" && (
                                    <span
                                      className="inline-flex shrink-0"
                                      title={t.dashboard.parsingFailed}
                                    >
                                      <AlertCircle className="size-3 text-destructive" />
                                    </span>
                                  )}

                                  {version.parseStatus === "parsing" && (
                                    <Loader2 className="size-3 animate-spin text-amber-500 shrink-0" />
                                  )}
                                </div>
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </ScrollArea>

      <Separator />

      {/* Action Footer */}
      <div className={cn("p-3 transition-all duration-300", collapsed && "p-2 flex justify-center")}>
        {collapsed ? (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="default"
                  size="icon-sm"
                  className="size-9 rounded-xl shadow-xs transition-all active:scale-95"
                  onClick={onOpenUpload}
                >
                  <Plus className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">
                {t.dashboard.uploadNewResume}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          <Button
            className="w-full gap-1.5 text-xs font-medium shadow-sm transition-all active:scale-[0.98]"
            size="sm"
            onClick={onOpenUpload}
          >
            <Plus className="size-3.5" />
            <span>{t.dashboard.uploadNewResume}</span>
          </Button>
        )}
      </div>
    </aside>
  );
}
