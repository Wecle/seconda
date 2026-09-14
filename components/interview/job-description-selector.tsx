"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Briefcase,
  FileText,
  Loader2,
  Plus,
  RotateCcw,
  Sparkles,
  UploadCloud,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useTranslation } from "@/lib/i18n/context";
import type { ResumeJobDescriptionItem } from "@/lib/jd/types";
import { cn } from "@/lib/utils";

export interface JobDescriptionSelectorProps {
  resumeId: string;
  selectedJdId?: string;
  selectedJd?: ResumeJobDescriptionItem | null;
  onSelectJd: (jd: ResumeJobDescriptionItem | null) => void;
  disabled?: boolean;
  className?: string;
}

export function JobDescriptionSelector({
  resumeId,
  selectedJdId,
  selectedJd,
  onSelectJd,
  disabled = false,
  className,
}: JobDescriptionSelectorProps) {
  const { t, locale } = useTranslation();
  const [savedJds, setSavedJds] = useState<ResumeJobDescriptionItem[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [currentJd, setCurrentJd] = useState<ResumeJobDescriptionItem | null>(selectedJd ?? null);
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [isEditingSelection, setIsEditingSelection] = useState(false);
  const [activeTab, setActiveTab] = useState<"paste" | "upload">("paste");
  const [pastedText, setPastedText] = useState("");
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch saved JDs on mount or resumeId change
  const fetchJds = useCallback(async () => {
    if (!resumeId) return;
    setLoadingList(true);
    try {
      const res = await fetch(`/api/resumes/${resumeId}/job-descriptions`);
      if (res.ok) {
        const data = (await res.json()) as { items: ResumeJobDescriptionItem[] };
        setSavedJds(data.items || []);
      }
    } catch {
      // Non-fatal if listing fails initially
    } finally {
      setLoadingList(false);
    }
  }, [resumeId]);

  useEffect(() => {
    void fetchJds();
  }, [fetchJds]);

  // Sync selectedJd or selectedJdId from props
  useEffect(() => {
    if (selectedJd) {
      setCurrentJd(selectedJd);
      return;
    }
    if (selectedJd === null && selectedJdId && savedJds.length > 0) {
      const found = savedJds.find((item) => item.id === selectedJdId);
      if (found) {
        setCurrentJd(found);
        onSelectJd(found);
        return;
      }
    }
    if (selectedJd === null && !selectedJdId) {
      setCurrentJd(null);
    }
  }, [selectedJd, selectedJdId, savedJds, onSelectJd]);

  const handleSelectExisting = (jdId: string) => {
    if (jdId === "__add_new__") {
      setIsAddingNew(true);
      setIsEditingSelection(false);
      return;
    }
    const found = savedJds.find((item) => item.id === jdId) ?? null;
    setCurrentJd(found);
    setIsAddingNew(false);
    setIsEditingSelection(false);
    onSelectJd(found);
  };

  const handleClearJd = () => {
    setCurrentJd(null);
    setIsAddingNew(false);
    setIsEditingSelection(false);
    onSelectJd(null);
    setError(null);
  };

  const handleFileDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    if (disabled || parsing) return;

    const file = event.dataTransfer.files?.[0];
    if (file) {
      validateAndSetFile(file);
    }
  };

  const validateAndSetFile = (file: File) => {
    const filename = file.name.toLowerCase();
    const isSupported =
      filename.endsWith(".pdf") ||
      filename.endsWith(".docx") ||
      file.type === "application/pdf" ||
      file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

    if (!isSupported) {
      setError(t.interview.jdFormatError);
      return;
    }

    if (file.size > 1 * 1024 * 1024) {
      setError(t.interview.jdFileSizeError);
      return;
    }

    setError(null);
    setUploadedFile(file);
  };

  const handleParseAndBind = async () => {
    if (disabled || parsing) return;
    setError(null);

    if (activeTab === "paste") {
      const text = pastedText.trim();
      if (!text) {
        setError(t.interview.jdTextRequired);
        return;
      }
      if (text.length > 8000) {
        setError(t.interview.jdTextTooLong);
        return;
      }

      setParsing(true);
      try {
        const res = await fetch(`/api/resumes/${resumeId}/job-descriptions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || t.interview.parseJdFailed);
        }

        const createdJd = data.item as ResumeJobDescriptionItem;
        setSavedJds((prev) => [createdJd, ...prev]);
        setCurrentJd(createdJd);
        setPastedText("");
        setIsAddingNew(false);
        setIsEditingSelection(false);
        onSelectJd(createdJd);
        toast.success(t.interview.jdDecodedSuccess);
      } catch (err) {
        const msg = err instanceof Error ? err.message : t.interview.parseJdFailed;
        setError(msg);
        toast.error(msg);
      } finally {
        setParsing(false);
      }
    } else {
      if (!uploadedFile) {
        setError(t.interview.jdFileRequired);
        return;
      }

      setParsing(true);
      try {
        const formData = new FormData();
        formData.append("file", uploadedFile);

        const res = await fetch(`/api/resumes/${resumeId}/job-descriptions`, {
          method: "POST",
          body: formData,
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || t.interview.parseJdFailed);
        }

        const createdJd = data.item as ResumeJobDescriptionItem;
        setSavedJds((prev) => [createdJd, ...prev]);
        setCurrentJd(createdJd);
        setUploadedFile(null);
        setIsAddingNew(false);
        setIsEditingSelection(false);
        onSelectJd(createdJd);
        toast.success(t.interview.jdDecodedSuccess);
      } catch (err) {
        const msg = err instanceof Error ? err.message : t.interview.parseJdFailed;
        setError(msg);
        toast.error(msg);
      } finally {
        setParsing(false);
      }
    }
  };

  return (
    <div className={cn("space-y-3", className)}>
      {/* 1. Selected JD Active Card */}
      {currentJd && !isAddingNew && !isEditingSelection ? (
        <div className="rounded-xl border border-primary/30 bg-primary/[0.03] p-4 shadow-2xs space-y-3 transition-all">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Briefcase className="size-4.5" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary" className="border border-primary/20 bg-primary/10 text-primary text-[11px] font-medium">
                    {t.interview.targetJdBadge}
                  </Badge>
                  <span className="font-semibold text-sm text-foreground truncate">
                    {currentJd.title}
                  </span>
                  {currentJd.company ? (
                    <span className="text-xs text-muted-foreground">· {currentJd.company}</span>
                  ) : null}
                  <Badge variant="outline" className="text-[11px] font-medium border-primary/30 text-primary">
                    {t.interview.levels[currentJd.parsedJson.experienceLevel] ?? currentJd.parsedJson.experienceLevel}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground line-clamp-1">
                  {currentJd.parsedJson.coreResponsibilities?.[0] || ""}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground gap-1"
                disabled={disabled}
                onClick={() => setIsEditingSelection(true)}
              >
                <RotateCcw className="size-3" />
                <span>{t.interview.changeJd}</span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground hover:text-destructive"
                disabled={disabled}
                onClick={handleClearJd}
                title={t.interview.clearJd}
              >
                <X className="size-3.5" />
              </Button>
            </div>
          </div>

          {/* Competency tags */}
          {currentJd.parsedJson.competencyKeywords && currentJd.parsedJson.competencyKeywords.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 pt-1 border-t border-border/40">
              {currentJd.parsedJson.competencyKeywords.slice(0, 5).map((kw, i) => (
                <Badge
                  key={i}
                  variant="secondary"
                  className="rounded-md border border-primary/15 bg-primary/5 text-[11px] font-normal px-2 py-0 text-primary"
                >
                  {kw}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>
      ) : isAddingNew ? (
        /* 2. Add New JD Panel (Paste / Upload Tabs) */
        <div className="rounded-xl border border-border/80 bg-muted/20 p-4 space-y-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-primary" />
              <h4 className="text-xs font-semibold text-foreground uppercase tracking-wider">
                {t.interview.addNewJd}
              </h4>
            </div>
            {savedJds.length > 0 || currentJd ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-muted-foreground hover:text-foreground"
                disabled={parsing}
                onClick={() => setIsAddingNew(false)}
              >
                {t.common.cancel}
              </Button>
            ) : null}
          </div>

          <Tabs
            value={activeTab}
            onValueChange={(val) => {
              setActiveTab(val as "paste" | "upload");
              setError(null);
            }}
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="paste" className="gap-1.5 text-xs">
                <FileText className="size-3.5" />
                <span>{t.interview.pasteJdTab}</span>
              </TabsTrigger>
              <TabsTrigger value="upload" className="gap-1.5 text-xs">
                <UploadCloud className="size-3.5" />
                <span>{t.interview.uploadJdTab}</span>
              </TabsTrigger>
            </TabsList>

            {/* Tab 1: Paste Text */}
            <TabsContent value="paste" className="space-y-3 pt-2">
              <Textarea
                value={pastedText}
                onChange={(e) => {
                  setPastedText(e.target.value);
                  if (error) setError(null);
                }}
                placeholder={t.interview.jdTextInputPlaceholder}
                disabled={disabled || parsing}
                rows={5}
                className="min-h-28 resize-y text-xs sm:text-sm bg-background"
              />
            </TabsContent>

            {/* Tab 2: Upload File */}
            <TabsContent value="upload" className="space-y-3 pt-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className="hidden"
                disabled={disabled || parsing}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) validateAndSetFile(file);
                }}
              />

              <div
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if ((e.key === "Enter" || e.key === " ") && !disabled && !parsing) {
                    e.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (!disabled && !parsing) setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleFileDrop}
                onClick={() => {
                  if (!disabled && !parsing) fileInputRef.current?.click();
                }}
                className={cn(
                  "relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center cursor-pointer transition-colors",
                  isDragging
                    ? "border-primary bg-primary/10"
                    : "border-border/80 bg-background hover:border-primary/50 hover:bg-muted/30",
                  (disabled || parsing) && "pointer-events-none opacity-60",
                )}
              >
                {uploadedFile ? (
                  <div className="flex items-center gap-3">
                    <FileText className="size-8 text-primary shrink-0" />
                    <div className="text-left min-w-0">
                      <p className="font-medium text-xs text-foreground truncate max-w-xs">
                        {uploadedFile.name}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {(uploadedFile.size / 1024).toFixed(1)} KB
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7 text-muted-foreground hover:text-destructive shrink-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        setUploadedFile(null);
                      }}
                    >
                      <X className="size-3.5" />
                    </Button>
                  </div>
                ) : (
                  <>
                    <UploadCloud className="size-7 text-muted-foreground/80 mb-2" />
                    <p className="text-xs font-medium text-foreground">{t.interview.dropJdFile}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {locale === "en" ? "Max file size: 1MB" : "最大支持 1MB"}
                    </p>
                  </>
                )}
              </div>
            </TabsContent>
          </Tabs>

          {/* Error Message */}
          {error ? (
            <div className="flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <AlertCircle className="size-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}

          {/* Action Button */}
          <div className="flex justify-end pt-1">
            <Button
              type="button"
              size="sm"
              disabled={
                disabled ||
                parsing ||
                (activeTab === "paste" ? !pastedText.trim() : !uploadedFile)
              }
              onClick={handleParseAndBind}
              className="gap-1.5 shadow-xs text-xs"
            >
              {parsing ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  <span>{t.interview.parsingJd}</span>
                </>
              ) : (
                <>
                  <Sparkles className="size-3.5" />
                  <span>{t.interview.parseAndBind}</span>
                </>
              )}
            </Button>
          </div>
        </div>
      ) : (
        /* 3. Selector / Dropdown View */
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
          {savedJds.length > 0 ? (
            <Select
              value={currentJd?.id ?? undefined}
              onValueChange={handleSelectExisting}
              disabled={disabled || loadingList}
            >
              <SelectTrigger className="flex-1 text-xs">
                <SelectValue placeholder={t.interview.useExistingJd} />
              </SelectTrigger>
              <SelectContent>
                {savedJds.map((jd) => (
                  <SelectItem key={jd.id} value={jd.id} className="text-xs">
                    <span className="font-medium text-foreground">{jd.title}</span>
                    {jd.company ? (
                      <span className="text-muted-foreground ml-1.5">({jd.company})</span>
                    ) : null}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <div className="flex-1 rounded-lg border border-dashed border-border/70 px-3 py-2 text-xs text-muted-foreground">
              {loadingList ? (
                <span className="flex items-center gap-1.5">
                  <Loader2 className="size-3 animate-spin" />
                  <span>{t.interview.loadingJdList}</span>
                </span>
              ) : (
                <span>{t.interview.noSavedJds}</span>
              )}
            </div>
          )}

          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => setIsAddingNew(true)}
            className="shrink-0 gap-1.5 text-xs shadow-2xs"
          >
            <Plus className="size-3.5" />
            <span>{t.interview.addNewJd}</span>
          </Button>

          {isEditingSelection && currentJd ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => setIsEditingSelection(false)}
              className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
            >
              {t.common.cancel}
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}
