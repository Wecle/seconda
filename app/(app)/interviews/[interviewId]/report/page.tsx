"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter, useParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { BrandIcon } from "@/components/brand/brand-icon";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  UserAvatarMenu,
  type UserAvatarMenuUser,
} from "@/components/auth/user-avatar-menu";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Share2,
  Copy,
  FileDown,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Search,
  Loader2,
  ShieldOff,
} from "lucide-react";
import { useTranslation } from "@/lib/i18n/context";
import { ReportOverviewGrid } from "@/components/interview/report/report-overview-grid";
import type { ReportPdfQuestionItem } from "@/components/interview/report/report-pdf-document";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function getScoreColor(score: number) {
  if (score >= 8)
    return "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300";
  if (score >= 5)
    return "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300";
  return "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300";
}

function getTypeColor(type: string) {
  if (type?.toLowerCase().includes("behavioral"))
    return "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300";
  if (type?.toLowerCase().includes("system"))
    return "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300";
  return "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300";
}

type ReportDimensionKey =
  | "understanding"
  | "expression"
  | "logic"
  | "depth"
  | "authenticity"
  | "reflection";

const radarDimensionOrder: ReportDimensionKey[] = [
  "understanding",
  "expression",
  "logic",
  "depth",
  "authenticity",
  "reflection",
];

interface ReportDimensionItem {
  name: string;
  score: number;
}

type ReportDimensions =
  | Partial<Record<ReportDimensionKey, number>>
  | ReportDimensionItem[];

interface ReportJson {
  overallScore: number;
  dimensions: ReportDimensions;
  topStrengths: string[];
  criticalFocus: string[];
  summary: string;
  nextSteps: string[];
}

interface InterviewData {
  id: string;
  level: string;
  type: string;
  language: string;
  questionCount: number;
  persona: string;
  status: string;
  overallScore: number | null;
  reportJson: ReportJson | null;
  startedAt: string;
  completedAt: string | null;
}

interface QuestionScore {
  understanding: number;
  expression: number;
  logic: number;
  depth: number;
  authenticity: number;
  reflection: number;
  overall: number;
}

interface QuestionFeedback {
  strengths?: string[];
  improvements?: string[];
  advice?: string[];
  deepDive?: unknown;
}

interface QuestionData {
  id: string;
  questionIndex: number;
  questionType: string;
  topic: string | null;
  question: string;
  tip: string | null;
  answerText: string | null;
  answeredAt: string | null;
  score: QuestionScore | null;
  feedback: QuestionFeedback | null;
  feedbackJson?: QuestionFeedback | null;
}

interface InterviewApiResponse {
  interview: InterviewData;
  questions: QuestionData[];
}

type FilterTab = "All" | "Behavioral" | "Technical";
type ShareMethod = "copy" | "system";

interface ShareStateResponse {
  status: "none" | "active" | "revoked" | "expired";
  isActive: boolean;
  expiresAt: string | null;
  shareUrl: string | null;
}

function normalizeRadarScore(score: unknown) {
  if (typeof score !== "number" || Number.isNaN(score)) return 0.5;
  const normalized = score > 10 ? score / 100 : score / 10;
  return Math.max(0, Math.min(1, normalized));
}

function buildRadarValues(dimensions: ReportDimensions | undefined) {
  if (!dimensions) return [0.5, 0.5, 0.5, 0.5, 0.5, 0.5];

  if (Array.isArray(dimensions)) {
    return radarDimensionOrder.map((key) => {
      const dim = dimensions.find((d) => d.name?.toLowerCase() === key);
      return normalizeRadarScore(dim?.score);
    });
  }

  return radarDimensionOrder.map((key) => {
    return normalizeRadarScore(dimensions[key]);
  });
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("Failed to convert blob to data URL"));
    };
    reader.onerror = () => reject(new Error("Failed to read blob"));
    reader.readAsDataURL(blob);
  });
}

const shareExpiryOptions = [
  { value: "24", hours: 24 },
  { value: "72", hours: 72 },
  { value: "168", hours: 168 },
  { value: "720", hours: 720 },
] as const;

export default function ReportPage() {
  const router = useRouter();
  const { interviewId } = useParams();
  const logoDataUrlRef = useRef<string | null>(null);
  const [data, setData] = useState<InterviewApiResponse | null>(null);
  const [currentUser, setCurrentUser] = useState<UserAvatarMenuUser | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState<FilterTab>("All");
  const [exportLoading, setExportLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [shareState, setShareState] = useState<ShareStateResponse | null>(null);
  const [shareStateLoading, setShareStateLoading] = useState(false);
  const [shareActionLoading, setShareActionLoading] = useState<ShareMethod | null>(
    null,
  );
  const [shareRevokeLoading, setShareRevokeLoading] = useState(false);
  const [shareExpiry, setShareExpiry] = useState<string>("168");
  const [shareDialogMessage, setShareDialogMessage] = useState<string | null>(null);
  const { t } = useTranslation();

  useEffect(() => {
    fetch(`/api/interviews/${interviewId}`)
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        setLoading(false);
      });
  }, [interviewId]);

  useEffect(() => {
    let mounted = true;
    fetch("/api/auth/session")
      .then((res) => (res.ok ? res.json() : null))
      .then((session) => {
        if (!mounted || !session) return;
        setCurrentUser(session.user ?? null);
      })
      .catch(() => {
        if (mounted) {
          setCurrentUser(null);
        }
      });
    return () => {
      mounted = false;
    };
  }, []);

  const filterTabs: FilterTab[] = ["All", "Behavioral", "Technical"];

  const filterTabLabels: Record<FilterTab, string> = {
    All: t.report.all,
    Behavioral: t.interview.behavioral,
    Technical: t.interview.technical,
  };

  const radarLabelNames = [
    t.report.radarLabels.understanding,
    t.report.radarLabels.expression,
    t.report.radarLabels.logic,
    t.report.radarLabels.depth,
    t.report.radarLabels.authenticity,
    t.report.radarLabels.reflection,
  ];

  const shareExpiryLabels: Record<string, string> = {
    "24": t.report.shareExpiry24h,
    "72": t.report.shareExpiry72h,
    "168": t.report.shareExpiry168h,
    "720": t.report.shareExpiry720h,
  };

  const interview = data?.interview;
  const questions = data?.questions || [];
  const report: ReportJson | null = interview?.reportJson ?? null;
  const overallScore = interview?.overallScore ?? 0;

  const levelLabels: Record<string, string> = {
    junior: t.interview.levels.Junior,
    mid: t.interview.levels.Mid,
    senior: t.interview.levels.Senior,
  };
  const interviewTypeLabels: Record<string, string> = {
    behavioral: t.interview.behavioral,
    technical: t.interview.technical,
    mixed: t.interview.mixed,
  };
  const questionTypeLabels: Record<string, string> = {
    behavioral: t.interview.behavioral,
    technical: t.interview.technical,
    mixed: t.interview.mixed,
    system: t.interview.technical,
  };
  const interviewStatusLabels: Record<string, string> = {
    active: t.report.statuses.active,
    completed: t.report.statuses.completed,
  };
  const levelLabel = interview?.level
    ? (levelLabels[interview.level.toLowerCase()] ?? interview.level)
    : "--";
  const interviewTypeLabel = interview?.type
    ? (interviewTypeLabels[interview.type.toLowerCase()] ?? interview.type)
    : "--";
  const interviewStatus = interview?.status?.toLowerCase() ?? "completed";
  const interviewStatusLabel =
    interviewStatusLabels[interviewStatus] ??
    interview?.status ??
    t.report.statuses.completed;

  const radarValues = buildRadarValues(report?.dimensions);
  const topStrengths =
    report && Array.isArray(report.topStrengths) ? report.topStrengths : [];
  const criticalFocus =
    report && Array.isArray(report.criticalFocus) ? report.criticalFocus : [];
  const displayName =
    currentUser?.name?.trim() ||
    currentUser?.email?.split("@")[0] ||
    t.auth.defaultUser;
  const websiteName = "Seconda";

  const fetchShareState = useCallback(async () => {
    const reportId =
      typeof interviewId === "string" ? interviewId : data?.interview?.id;
    if (!reportId) return;

    setShareStateLoading(true);
    try {
      const response = await fetch(`/api/interviews/${reportId}/share-link`);
      if (!response.ok) {
        throw new Error("Failed to load share state");
      }
      const payload = (await response.json()) as ShareStateResponse;
      setShareState(payload);
    } catch {
      setShareState(null);
    } finally {
      setShareStateLoading(false);
    }
  }, [interviewId, data?.interview?.id]);

  useEffect(() => {
    if (!shareDialogOpen) return;
    setShareDialogMessage(null);
    void fetchShareState();
  }, [shareDialogOpen, fetchShareState]);

  const createShareLink = async () => {
    const reportId =
      typeof interviewId === "string" ? interviewId : data?.interview?.id;
    if (!reportId) return null;

    const expiresInHours = Number(shareExpiry);
    const response = await fetch(`/api/interviews/${reportId}/share-link`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expiresInHours }),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as ShareStateResponse;
    setShareState(payload);
    return payload.shareUrl;
  };

  const handleShareByMethod = async (method: ShareMethod) => {
    if (
      typeof window === "undefined" ||
      shareActionLoading ||
      shareRevokeLoading ||
      exportLoading
    ) {
      return;
    }

    const shareTitle = `${websiteName} · ${t.report.title}`;
    setShareActionLoading(method);
    setShareDialogMessage(null);
    setActionMessage(null);

    try {
      const shareUrl = await createShareLink();
      if (!shareUrl) {
        setShareDialogMessage(t.report.shareFailed);
        return;
      }

      if (method === "system" && typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({
          title: shareTitle,
          text: t.report.shareDescription,
          url: shareUrl,
        });
        setShareDialogMessage(t.report.shareSuccess);
        setActionMessage(t.report.shareSuccess);
        return;
      }

      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
        setShareDialogMessage(
          method === "copy" ? t.report.shareCopied : t.report.shareSystemFallback,
        );
        setActionMessage(
          method === "copy" ? t.report.shareCopied : t.report.shareSystemFallback,
        );
        return;
      }

      setShareDialogMessage(t.report.shareFailed);
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "name" in error &&
        error.name === "AbortError"
      ) {
        return;
      }
      setShareDialogMessage(t.report.shareFailed);
    } finally {
      setShareActionLoading(null);
    }
  };

  const handleRevokeShare = async () => {
    if (shareRevokeLoading || shareActionLoading || exportLoading) return;
    const reportId =
      typeof interviewId === "string" ? interviewId : data?.interview?.id;
    if (!reportId) return;

    setShareRevokeLoading(true);
    setShareDialogMessage(null);
    setActionMessage(null);
    try {
      const response = await fetch(`/api/interviews/${reportId}/share-link`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error("Failed to revoke share");
      }
      await fetchShareState();
      setShareDialogMessage(t.report.shareRevokedSuccess);
      setActionMessage(t.report.shareRevokedSuccess);
    } catch {
      setShareDialogMessage(t.report.shareRevokedFailed);
    } finally {
      setShareRevokeLoading(false);
    }
  };

  const handleExportPdf = async () => {
    if (exportLoading || shareActionLoading !== null || shareRevokeLoading) return;

    setExportLoading(true);
    setActionMessage(null);

    try {
      const generatedAt = new Date();
      const [{ pdf }, { ReportPdfDocument }] = await Promise.all([
        import("@react-pdf/renderer"),
        import("@/components/interview/report/report-pdf-document"),
      ]);

      let logoDataUrl = logoDataUrlRef.current;
      if (!logoDataUrl) {
        const logoResponse = await fetch("/logo.png");
        if (!logoResponse.ok) {
          throw new Error("Failed to load logo");
        }
        logoDataUrl = await blobToDataUrl(await logoResponse.blob());
        logoDataUrlRef.current = logoDataUrl;
      }

      const reportQuestions: ReportPdfQuestionItem[] = questions.map((q, idx) => {
        const feedback = q.feedbackJson || q.feedback || {};
        return {
          id: q.id,
          questionIndex: q.questionIndex ?? idx + 1,
          question: q.question,
          answerText: q.answerText,
          score: q.score?.overall ?? 0,
          strengths: feedback.strengths || [],
          improvements: feedback.improvements || [],
          advice: feedback.advice || [],
        };
      });

      const reportId =
        typeof interviewId === "string" ? interviewId : "interview-report";

      const blob = await pdf(
        <ReportPdfDocument
          websiteName={websiteName}
          logoDataUrl={logoDataUrl}
          reportTitle={t.report.title}
          userName={displayName}
          generatedAtText={generatedAt.toLocaleString()}
          interviewId={reportId}
          overallScore={overallScore}
          interviewTypeLabel={interviewTypeLabel}
          levelLabel={levelLabel}
          questionCount={questions.length}
          summary={report?.summary || t.report.noAnalysisData}
          topStrengths={topStrengths}
          criticalFocus={criticalFocus}
          questions={reportQuestions}
          labels={{
            score: t.report.score,
            interviewType: t.report.meta.interviewType,
            targetLevel: t.report.meta.targetLevel,
            questions: t.report.questions,
            analysisSummary: t.report.analysisSummary,
            topStrength: t.report.topStrength,
            criticalFocus: t.report.criticalFocus,
            noAnalysisData: t.report.noAnalysisData,
            yourAnswer: t.report.yourAnswer,
            strengths: t.report.strengths,
            improvements: t.report.improvements,
            advice: t.report.advice,
            exportedFor: t.report.exportedFor,
            generatedAt: t.report.generatedAt,
            detailedAnalysis: t.report.detailedAnalysis,
          }}
        />,
      ).toBlob();

      const pdfUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = pdfUrl;
      link.download = `${websiteName.toLowerCase()}-report-${reportId}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(pdfUrl);

      setActionMessage(t.report.exportSuccess);
    } catch {
      setActionMessage(t.report.exportFailed);
    } finally {
      setExportLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    );
  }

  const filteredQuestions = questions.filter((q: QuestionData) => {
    if (activeFilter === "All") return true;
    return q.questionType?.toLowerCase().includes(activeFilter.toLowerCase());
  });

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-card border-b">
        <div className="max-w-[1200px] mx-auto flex items-center justify-between px-4 sm:px-8 h-16">
          <Link
            href="/"
            className="flex items-center gap-2 text-xl font-bold tracking-tight"
          >
            <BrandIcon size={28} />
            <span>Seconda</span>
          </Link>
          <div className="flex items-center gap-6">
            <nav className="hidden sm:flex items-center gap-5 text-sm text-muted-foreground">
              <Link
                href="/dashboard"
                className="hover:text-foreground transition-colors"
              >
                {t.report.dashboard}
              </Link>
              <Link
                href="/dashboard"
                className="hover:text-foreground transition-colors"
              >
                {t.report.history}
              </Link>
            </nav>
            {currentUser ? (
              <UserAvatarMenu
                user={currentUser}
                avatarSize="sm"
                panelAlign="right"
                callbackUrl="/"
              />
            ) : (
              <Avatar size="sm">
                <AvatarFallback>U</AvatarFallback>
              </Avatar>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-[1200px] w-full mx-auto py-8 px-4 sm:px-8 pb-28">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-8">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-2xl font-bold tracking-tight">
                {t.report.title}
              </h1>
              <Badge
                className={cn(
                  "border-0",
                  interviewStatus === "completed"
                    ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
                    : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
                )}
              >
                {interviewStatusLabel}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {t.report.meta.interviewType}: {interviewTypeLabel} &bull;{" "}
              {t.report.meta.targetLevel}: {levelLabel} &bull;{" "}
              {t.report.meta.status}: {interviewStatusLabel} &bull;{" "}
              {questions.length} {t.report.questions}
            </p>
          </div>
          <div className="flex flex-col items-start sm:items-end gap-2">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShareDialogOpen(true)}
                disabled={exportLoading}
              >
                <Share2 />
                {t.report.shareReport}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleExportPdf()}
                disabled={
                  exportLoading || shareActionLoading !== null || shareRevokeLoading
                }
              >
                {exportLoading ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <FileDown />
                )}
                {t.report.exportReport}
              </Button>
            </div>
            {actionMessage ? (
              <p className="text-xs text-muted-foreground">{actionMessage}</p>
            ) : null}
          </div>
        </div>

        <ReportOverviewGrid
          overallScore={overallScore}
          radarValues={radarValues}
          radarLabelNames={radarLabelNames}
          topStrengths={topStrengths}
          criticalFocus={criticalFocus}
          labels={{
            overallPerformance: t.report.overallPerformance,
            competencyBreakdown: t.report.competencyBreakdown,
            analysisSummary: t.report.analysisSummary,
            topStrength: t.report.topStrength,
            criticalFocus: t.report.criticalFocus,
            noAnalysisData: t.report.noAnalysisData,
            score: t.report.score,
            strongPerformer: t.report.strongPerformer,
            goodProgress: t.report.goodProgress,
            needsImprovement: t.report.needsImprovement,
          }}
        />

        {/* Detailed Question Analysis */}
        <div className="mb-4">
          <h2 className="text-lg font-semibold mb-4">
            {t.report.detailedAnalysis}
          </h2>
          <div className="flex items-center gap-2 mb-4">
            {filterTabs.map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveFilter(tab)}
                className={cn(
                  "px-3 py-1.5 text-sm rounded-md font-medium transition-colors",
                  activeFilter === tab
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground",
                )}
              >
                {filterTabLabels[tab]}
              </button>
            ))}
          </div>
        </div>

        <Accordion
          type="single"
          defaultValue={filteredQuestions[0]?.id}
          collapsible
          className="space-y-4"
        >
          {filteredQuestions.map((q: QuestionData, idx: number) => {
            const score = q.score?.overall ?? 0;
            const feedback = q.feedbackJson || q.feedback || {};
            const strengths = feedback.strengths || [];
            const improvements = feedback.improvements || [];
            const advice = feedback.advice || [];
            const normalizedQuestionType = q.questionType?.toLowerCase() ?? "";
            const questionTypeLabel =
              questionTypeLabels[normalizedQuestionType] ??
              (normalizedQuestionType.includes("behavioral")
                ? t.interview.behavioral
                : normalizedQuestionType.includes("technical") ||
                    normalizedQuestionType.includes("system")
                  ? t.interview.technical
                  : q.questionType || q.topic || t.report.question);

            return (
              <AccordionItem
                key={q.id}
                value={q.id}
                className="border rounded-xl bg-card shadow-sm overflow-hidden"
              >
                <AccordionTrigger className="px-6 py-5 hover:no-underline">
                  <div className="flex flex-col gap-2 text-left w-full">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge
                        className={cn(
                          "border-0 text-xs",
                          getTypeColor(q.questionType),
                        )}
                      >
                        Q{q.questionIndex ?? idx + 1} &bull; {questionTypeLabel}
                      </Badge>
                      <Badge
                        className={cn("border-0 text-xs", getScoreColor(score))}
                      >
                        {t.report.score}: {score}/10
                      </Badge>
                    </div>
                    <p className="font-medium text-sm leading-snug">
                      {q.question}
                    </p>
                    {q.answerText && (
                      <p className="text-sm text-muted-foreground line-clamp-1">
                        {q.answerText}
                      </p>
                    )}
                    {score < 5 && (
                      <div className="flex items-center gap-1.5 text-orange-600 text-xs font-medium">
                        <AlertCircle className="size-3.5" />
                        {t.report.needsImprovementLabel}
                      </div>
                    )}
                    {score >= 8 && (
                      <div className="flex items-center gap-1.5 text-green-600 text-xs font-medium">
                        <CheckCircle2 className="size-3.5" />
                        {t.report.strongAnswer}
                      </div>
                    )}
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-6">
                  <div className="space-y-5">
                    {q.answerText && (
                      <div>
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                          {t.report.yourAnswer}
                        </h4>
                        <div className="bg-muted/50 rounded-lg p-4">
                          <p className="text-sm italic text-muted-foreground leading-relaxed">
                            &ldquo;{q.answerText}&rdquo;
                          </p>
                        </div>
                      </div>
                    )}

                    {(strengths.length > 0 ||
                      improvements.length > 0 ||
                      advice.length > 0) && (
                      <div>
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                          {t.report.aiFeedback}
                        </h4>
                        <div className="bg-primary/5 rounded-lg p-4">
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            {strengths.length > 0 && (
                              <div>
                                <p className="text-xs font-semibold text-green-600 mb-2 flex items-center gap-1.5">
                                  <span className="size-1.5 rounded-full bg-green-500" />
                                  {t.report.strengths}
                                </p>
                                <ul className="space-y-1.5">
                                  {strengths.map((s: string, i: number) => (
                                    <li
                                      key={i}
                                      className="text-sm text-foreground leading-snug"
                                    >
                                      {s}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {improvements.length > 0 && (
                              <div>
                                <p className="text-xs font-semibold text-orange-600 mb-2 flex items-center gap-1.5">
                                  <span className="size-1.5 rounded-full bg-orange-500" />
                                  {t.report.improvements}
                                </p>
                                <ul className="space-y-1.5">
                                  {improvements.map((s: string, i: number) => (
                                    <li
                                      key={i}
                                      className="text-sm text-foreground leading-snug"
                                    >
                                      {s}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {advice.length > 0 && (
                              <div>
                                <p className="text-xs font-semibold text-blue-600 mb-2 flex items-center gap-1.5">
                                  <span className="size-1.5 rounded-full bg-blue-500" />
                                  {t.report.advice}
                                </p>
                                <ul className="space-y-1.5">
                                  {advice.map((s: string, i: number) => (
                                    <li
                                      key={i}
                                      className="text-sm text-foreground leading-snug"
                                    >
                                      {s}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    <Button
                      className="w-full"
                      onClick={() =>
                        router.push(
                          `/interviews/${interviewId}/questions/${q.questionIndex}`,
                        )
                      }
                    >
                      <Search className="size-4" />
                      {t.report.deepDive}
                    </Button>
                  </div>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      </main>

      <Dialog open={shareDialogOpen} onOpenChange={setShareDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t.report.shareDialogTitle}</DialogTitle>
            <DialogDescription>{t.report.shareDialogDescription}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">
                {t.report.shareExpiryLabel}
              </p>
              <Select value={shareExpiry} onValueChange={setShareExpiry}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="start">
                  {shareExpiryOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {shareExpiryLabels[option.value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="rounded-lg border bg-muted/20 p-3 text-sm">
              {shareStateLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  {t.report.shareStateLoading}
                </div>
              ) : shareState?.isActive && shareState.expiresAt ? (
                <div className="space-y-1">
                  <p className="font-medium text-foreground">
                    {t.report.shareStateActive}
                  </p>
                  <p className="text-muted-foreground">
                    {t.report.shareActiveUntil}:{" "}
                    {new Date(shareState.expiresAt).toLocaleString()}
                  </p>
                </div>
              ) : shareState?.status === "expired" ? (
                <p className="text-muted-foreground">{t.report.shareStateExpired}</p>
              ) : shareState?.status === "revoked" ? (
                <p className="text-muted-foreground">{t.report.shareStateRevoked}</p>
              ) : (
                <p className="text-muted-foreground">{t.report.shareStateNone}</p>
              )}
            </div>

            {shareDialogMessage ? (
              <p className="text-xs text-muted-foreground">{shareDialogMessage}</p>
            ) : null}
          </div>

          <DialogFooter className="sm:justify-between">
            <Button
              variant="outline"
              onClick={() => void handleRevokeShare()}
              disabled={
                !shareState?.isActive ||
                shareRevokeLoading ||
                shareActionLoading !== null ||
                shareStateLoading
              }
            >
              {shareRevokeLoading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ShieldOff className="size-4" />
              )}
              {t.report.shareRevokeAction}
            </Button>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => void handleShareByMethod("copy")}
                disabled={
                  shareActionLoading !== null || shareRevokeLoading || shareStateLoading
                }
              >
                {shareActionLoading === "copy" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Copy className="size-4" />
                )}
                {t.report.shareCopyAction}
              </Button>
              <Button
                onClick={() => void handleShareByMethod("system")}
                disabled={
                  shareActionLoading !== null || shareRevokeLoading || shareStateLoading
                }
              >
                {shareActionLoading === "system" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Share2 className="size-4" />
                )}
                {t.report.shareSystemAction}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Floating Footer */}
      <div className="sticky bottom-6 z-50 flex justify-center pointer-events-none">
        <div className="pointer-events-auto bg-card border rounded-full px-2 py-2 shadow-lg">
          <Button
            className="rounded-full"
            size="lg"
            onClick={() => router.push("/dashboard")}
          >
            <RefreshCw className="size-4" />
            {t.report.startNewSession}
          </Button>
        </div>
      </div>
    </div>
  );
}
