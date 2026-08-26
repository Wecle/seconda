"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  History,
  Loader2,
  Play,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "@/lib/i18n/context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { InterviewCard } from "@/components/dashboard/interview-card";
import type { InterviewSummaryItem } from "@/components/dashboard/types";

interface InterviewHistoryDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resumeId: string | null;
  resumeTitle?: string;
  selectedVersionId: string | null;
  selectedVersionNumber: number | null;
  onStartInterview?: () => void;
  onInterviewsUpdated?: (interviews: InterviewSummaryItem[]) => void;
}

export function InterviewHistoryDrawer({
  open,
  onOpenChange,
  resumeId,
  resumeTitle,
  selectedVersionId,
  selectedVersionNumber,
  onStartInterview,
  onInterviewsUpdated,
}: InterviewHistoryDrawerProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"current" | "all">("current");
  const [interviews, setInterviews] = useState<InterviewSummaryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] =
    useState<InterviewSummaryItem | null>(null);

  const hasLoadedRef = useRef(false);
  const inFlightRef = useRef(false);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);
  const onUpdateRef = useRef(onInterviewsUpdated);
  const interviewsRef = useRef(interviews);

  useEffect(() => {
    onUpdateRef.current = onInterviewsUpdated;
  });

  useEffect(() => {
    interviewsRef.current = interviews;
  }, [interviews]);

  const fetchInterviewsBatch = useCallback(
    async (isSilent = false) => {
      if (!resumeId || inFlightRef.current) return;
      inFlightRef.current = true;

      if (!isSilent) {
        if (!hasLoadedRef.current) {
          setLoading(true);
        } else {
          setRefreshing(true);
        }
      }

      try {
        const res = await fetch(`/api/resumes/${resumeId}/interviews`);
        if (res.ok) {
          const data = (await res.json()) as InterviewSummaryItem[];
          setInterviews(data);
          hasLoadedRef.current = true;
          onUpdateRef.current?.(data);
        }
      } catch (e) {
        console.error("Failed to load resume interviews:", e);
      } finally {
        inFlightRef.current = false;
        setLoading(false);
        setRefreshing(false);
      }
    },
    [resumeId],
  );

  // Fetch initial batch when drawer opens or resumeId changes
  useEffect(() => {
    if (open && resumeId) {
      void fetchInterviewsBatch();
    } else {
      hasLoadedRef.current = false;
      setInterviews([]);
    }
  }, [open, resumeId, fetchInterviewsBatch]);

  // Single batch auto-polling every 5s when there are in-progress/completing interviews
  useEffect(() => {
    if (!open || !resumeId) {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      return;
    }

    let isMounted = true;

    const scheduleNextPoll = () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      pollTimerRef.current = setTimeout(async () => {
        if (!isMounted || !open || !resumeId) return;

        // Skip network request if tab is in background
        if (typeof document !== "undefined" && document.hidden) {
          if (isMounted) scheduleNextPoll();
          return;
        }

        const hasInProgress = interviewsRef.current.some(
          (item) =>
            item.status === "active" ||
            item.status === "initializing" ||
            item.status === "completing",
        );

        if (hasInProgress) {
          await fetchInterviewsBatch(true);
        }

        if (isMounted) {
          scheduleNextPoll();
        }
      }, 5000);
    };

    scheduleNextPoll();

    return () => {
      isMounted = false;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, [open, resumeId, fetchInterviewsBatch]);

  const handleDeleteConfirm = async () => {
    if (!pendingDelete) return;
    const targetId = pendingDelete.id;
    setDeletingId(targetId);

    try {
      const res = await fetch(`/api/interviews/${targetId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        toast.success(t.dashboard.interviewDrawer.deleteSuccess);
        setInterviews((prev) => {
          const next = prev.filter((item) => item.id !== targetId);
          onInterviewsUpdated?.(next);
          return next;
        });
      } else {
        toast.error(t.dashboard.interviewDrawer.deleteFailed);
      }
    } catch {
      toast.error(t.dashboard.interviewDrawer.deleteFailed);
    } finally {
      setDeletingId(null);
      setPendingDelete(null);
    }
  };

  const currentVersionInterviews = interviews.filter(
    (item) => item.resumeVersionId === selectedVersionId,
  );
  const displayedInterviews =
    tab === "current" ? currentVersionInterviews : interviews;

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className="flex h-full w-full flex-col gap-0 p-0 sm:max-w-md md:max-w-lg"
        >
          {/* Header */}
          <SheetHeader className="border-b px-6 py-4">
            <div className="flex items-center justify-between gap-3 pr-6">
              <div className="flex items-center gap-2.5">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <History className="size-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <SheetTitle className="text-base font-semibold">
                      {t.dashboard.interviewDrawer.title}
                    </SheetTitle>
                    {interviews.length > 0 && (
                      <Badge
                        variant="secondary"
                        className="px-1.5 py-0 text-[10px] font-mono font-medium"
                      >
                        {interviews.length}
                      </Badge>
                    )}
                  </div>
                  <SheetDescription className="truncate text-xs text-muted-foreground">
                    {resumeTitle || t.dashboard.resumes}
                  </SheetDescription>
                </div>
              </div>

              <Button
                variant="ghost"
                size="icon-xs"
                className="size-7 text-muted-foreground hover:text-foreground"
                onClick={() => void fetchInterviewsBatch(false)}
                disabled={loading || refreshing}
                title={t.dashboard.interviewDrawer.refresh}
              >
                <RefreshCw
                  className={`size-3.5 ${refreshing || loading ? "animate-spin" : ""}`}
                />
              </Button>
            </div>

            {/* Version Filter Tabs */}
            <div className="mt-2 pt-2">
              <Tabs
                value={tab}
                onValueChange={(val) => setTab(val as "current" | "all")}
                className="w-full"
              >
                <TabsList className="grid h-8 w-full grid-cols-2 p-0.5">
                  <TabsTrigger
                    value="current"
                    className="gap-1.5 text-xs font-medium"
                  >
                    <span>
                      {t.dashboard.interviewDrawer.currentVersionTab.replace(
                        "{version}",
                        String(selectedVersionNumber ?? 1),
                      )}
                    </span>
                    {currentVersionInterviews.length > 0 && (
                      <span className="rounded-full bg-primary/10 px-1.5 py-0 text-[10px] font-bold text-primary">
                        {currentVersionInterviews.length}
                      </span>
                    )}
                  </TabsTrigger>
                  <TabsTrigger
                    value="all"
                    className="gap-1.5 text-xs font-medium"
                  >
                    <span>{t.dashboard.interviewDrawer.allVersionsTab}</span>
                    {interviews.length > 0 && (
                      <span className="rounded-full bg-muted px-1.5 py-0 text-[10px] text-muted-foreground">
                        {interviews.length}
                      </span>
                    )}
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </SheetHeader>

          {/* List Content Area */}
          <ScrollArea className="min-h-0 flex-1">
            <div className="p-5">
              {loading ? (
                <div className="flex flex-col items-center justify-center py-16 text-center space-y-3">
                  <Loader2 className="size-7 animate-spin text-primary" />
                  <p className="text-xs text-muted-foreground">
                    {t.common.loading}
                  </p>
                </div>
              ) : displayedInterviews.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-xl border border-dashed p-8 text-center">
                  <div className="flex size-10 items-center justify-center rounded-full bg-muted/60 text-muted-foreground mb-3">
                    <Sparkles className="size-5" />
                  </div>
                  <h5 className="text-sm font-medium text-foreground">
                    {tab === "current"
                      ? t.dashboard.interviewDrawer.noInterviewsCurrentVersion
                      : t.dashboard.interviewDrawer.noInterviewsAll}
                  </h5>
                  <p className="mt-1 max-w-[240px] text-xs text-muted-foreground">
                    {t.dashboard.interviewDrawer.subtitle}
                  </p>
                  {onStartInterview && (
                    <Button
                      size="sm"
                      className="mt-4 gap-1.5 text-xs"
                      onClick={() => {
                        onOpenChange(false);
                        onStartInterview();
                      }}
                    >
                      <Play className="size-3.5 fill-current" />
                      {t.dashboard.interviewDrawer.startFirstInterview}
                    </Button>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  {displayedInterviews.map((item) => (
                    <InterviewCard
                      key={item.id}
                      interview={item}
                      showVersionBadge={tab === "all"}
                      onDeleteClick={(target) => setPendingDelete(target)}
                      deleting={deletingId === item.id}
                    />
                  ))}
                </div>
              )}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>

      {/* Delete Confirmation Alert Dialog */}
      <AlertDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => {
          if (!open && !deletingId) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t.dashboard.interviewDrawer.deleteConfirmTitle}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t.dashboard.interviewDrawer.deleteConfirmDesc}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(deletingId)}>
              {t.common.cancel}
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                void handleDeleteConfirm();
              }}
              disabled={Boolean(deletingId)}
            >
              {deletingId ? (
                <>
                  <Loader2 className="size-3.5 animate-spin mr-1" />
                  {t.common.deleting}
                </>
              ) : (
                t.common.delete
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
