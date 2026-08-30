import { useRef, useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Plus, Settings } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useTranslation } from "@/lib/i18n/context";
import type { CreateInterviewRequest } from "@/lib/interview/domain/create-interview";
import type { ResumeInterviewSettings } from "@/components/dashboard/types";
import {
  InterviewCreationClientError,
  requestInterviewCreation,
  resetInterviewCreationAttempt,
  resolveInterviewCreationAttempt,
  validateInterviewTargetRole,
  type InterviewCreationAttempt,
} from "@/lib/interview/client/create-interview";
import { cn } from "@/lib/utils";

type InterviewSettings = Omit<CreateInterviewRequest, "resumeVersionId">;

const PERSONAS = ["friendly", "standard", "stressful"] as const;
const PREFERENCE_TAGS = [
  "project_deep_dive",
  "technical_foundations",
  "behavioral_evidence",
] as const;

export interface InterviewSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode?: "settings" | "create";
  resumeId: string;
  resumeVersionId: string;
  defaultTargetRole: string;
  savedSettings?: ResumeInterviewSettings | null;
  onSettingsSaved?: (saved: ResumeInterviewSettings) => void;
  onSwitchToSettings?: () => void;
}

export function InterviewSettingsDialog({
  open,
  onOpenChange,
  mode = "create",
  resumeId,
  resumeVersionId,
  defaultTargetRole,
  savedSettings,
  onSettingsSaved,
  onSwitchToSettings,
}: InterviewSettingsDialogProps) {
  const router = useRouter();
  const { locale, t } = useTranslation();

  const getInitialSettings = useCallback((): InterviewSettings => {
    const validLocale: "zh" | "en" | "es" | "de" =
      locale === "zh" || locale === "en" || locale === "es" || locale === "de"
        ? locale
        : "zh";

    return {
      language: savedSettings?.language ?? validLocale,
      persona: savedSettings?.persona ?? "standard",
      interviewType: savedSettings?.interviewType ?? "mixed",
      targetLevel: savedSettings?.targetLevel ?? "Mid",
      targetRole: (savedSettings?.targetRole || defaultTargetRole).trim(),
      preference: savedSettings?.preference ?? "",
      preferenceTags: savedSettings?.preferenceTags ?? [],
      targetRoundCount: savedSettings?.targetRoundCount ?? 8,
    };
  }, [defaultTargetRole, locale, savedSettings]);

  const [settings, setSettings] = useState<InterviewSettings>(() => getInitialSettings());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const creationAttempt = useRef<InterviewCreationAttempt | null>(null);
  const targetRoleError = validateInterviewTargetRole(settings.targetRole);

  useEffect(() => {
    if (open) {
      setSettings(getInitialSettings());
      setError(null);
    }
  }, [open, getInitialSettings]);

  const updateSettings = <Key extends keyof InterviewSettings>(
    key: Key,
    value: InterviewSettings[Key],
  ) => {
    setSettings((current) => ({ ...current, [key]: value }));
    setError(null);
  };

  const togglePreferenceTag = (tagLabel: string, tagKey?: string) => {
    const isSelected =
      settings.preferenceTags.includes(tagLabel) ||
      (tagKey ? settings.preferenceTags.includes(tagKey) : false);
    updateSettings(
      "preferenceTags",
      isSelected
        ? settings.preferenceTags.filter(
            (current) => current !== tagLabel && current !== tagKey,
          )
        : [...settings.preferenceTags, tagLabel].slice(0, 3),
    );
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && submitting) return;
    onOpenChange(nextOpen);
    if (!nextOpen) {
      setError(null);
      creationAttempt.current = resetInterviewCreationAttempt();
    }
  };

  const saveSettingsToResume = async (settingsToSave: InterviewSettings) => {
    const payload: ResumeInterviewSettings = {
      ...settingsToSave,
      targetRole: settingsToSave.targetRole.trim(),
      preference: settingsToSave.preference.trim(),
    };
    const response = await fetch(`/api/resumes/${resumeId}/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error("Failed to save settings");
    }
    const data = await response.json();
    onSettingsSaved?.(data.interviewSettings as ResumeInterviewSettings);
    return data.interviewSettings as ResumeInterviewSettings;
  };

  const handleSubmit = async () => {
    if (targetRoleError || submitting) return;

    if (mode === "settings") {
      setSubmitting(true);
      setError(null);
      try {
        await saveSettingsToResume(settings);
        toast.success(t.interview.saveSettingsSuccess);
        handleOpenChange(false);
      } catch {
        setError(t.interview.saveSettingsFailed);
      } finally {
        setSubmitting(false);
      }
      return;
    }

    const request: CreateInterviewRequest = {
      resumeVersionId,
      ...settings,
      targetRole: settings.targetRole.trim(),
      preference: settings.preference.trim(),
    };
    creationAttempt.current = resolveInterviewCreationAttempt({
      previous: creationAttempt.current,
      request,
      createKey: () => crypto.randomUUID(),
    });

    setSubmitting(true);
    setError(null);
    try {
      const creation = await requestInterviewCreation({
        idempotencyKey: creationAttempt.current.idempotencyKey,
        request,
      });
      creationAttempt.current = resetInterviewCreationAttempt();
      router.push(`/interviews/${creation.interviewId}`);
    } catch (cause) {
      if (
        cause instanceof InterviewCreationClientError &&
        cause.code === "INTERVIEW_IDEMPOTENCY_CONFLICT"
      ) {
        setError(t.interview.creationConflict);
      } else {
        setError(t.interview.creationFailed);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-h-[calc(100vh-2rem)] overflow-hidden p-0 sm:max-w-2xl"
        onEscapeKeyDown={(event) => {
          if (submitting) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (submitting) event.preventDefault();
        }}
      >
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
        >
          <div className="shrink-0 border-b px-6 py-5">
            <DialogHeader className="pr-8">
              <DialogTitle>
                {mode === "settings"
                  ? t.interview.settingsTitle
                  : t.interview.startConfirmTitle}
              </DialogTitle>
              <DialogDescription className="leading-5">
                {mode === "settings"
                  ? t.interview.settingsDescriptionEdit
                  : t.interview.startConfirmDescription}
              </DialogDescription>
            </DialogHeader>
          </div>

          {mode === "create" ? (
            <div className="min-h-0 space-y-4 overflow-y-auto px-6 py-5">
              <div className="rounded-xl border bg-muted/20 p-4 space-y-3.5">
                <div className="flex items-start justify-between gap-3 border-b pb-3">
                  <div>
                    <span className="text-xs text-muted-foreground">
                      {t.interview.targetRole}
                    </span>
                    <p className="text-base font-semibold text-foreground mt-0.5">
                      {settings.targetRole || t.dashboard.noResumeSelected}
                    </p>
                  </div>
                  <Badge variant="secondary" className="px-2.5 py-1 text-xs">
                    {t.interview.levels[settings.targetLevel]}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
                  <div>
                    <span className="text-muted-foreground">
                      {t.interview.interviewType}
                    </span>
                    <p className="font-medium text-foreground mt-0.5">
                      {settings.interviewType === "behavioral"
                        ? t.interview.behavioral
                        : settings.interviewType === "technical"
                          ? t.interview.technical
                          : t.interview.mixed}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">
                      {t.interview.language}
                    </span>
                    <p className="font-medium text-foreground mt-0.5">
                      {t.interview.languages[settings.language]}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">
                      {t.interview.questionCount}
                    </span>
                    <p className="font-medium text-foreground mt-0.5">
                      {settings.targetRoundCount} {t.interview.questionsUnit}
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border p-4 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">
                    {t.interview.persona}
                  </span>
                  <Badge variant="outline" className="text-xs font-normal">
                    {t.interview.personas[settings.persona].label}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {t.interview.personas[settings.persona].description}
                </p>
              </div>

              <div className="rounded-xl border p-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">
                    {t.interview.preference}
                  </span>
                  {settings.preferenceTags.length > 0 && (
                    <span className="text-xs text-muted-foreground">
                      {settings.preferenceTags.length} 项偏好
                    </span>
                  )}
                </div>
                {settings.preferenceTags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {settings.preferenceTags.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary"
                      >
                        <Check className="size-3 stroke-[2.5]" />
                        <span>{tag}</span>
                      </span>
                    ))}
                  </div>
                )}
                <p className="text-xs text-foreground/90 leading-relaxed whitespace-pre-wrap">
                  {settings.preference || t.interview.noPreference}
                </p>
              </div>

              {onSwitchToSettings ? (
                <div className="flex items-center justify-between pt-1 text-xs text-muted-foreground">
                  <span>如需修改上述配置，可点击右侧按钮</span>
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-xs text-primary gap-1"
                    onClick={() => onSwitchToSettings()}
                  >
                    <Settings className="size-3" />
                    <span>{t.interview.editSettingsPrompt}</span>
                  </Button>
                </div>
              ) : null}

              {error ? (
                <p
                  role="alert"
                  className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
                >
                  {error}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="min-h-0 space-y-6 overflow-y-auto px-6 py-5">
              <div className="space-y-2">
                <Label htmlFor="interview-target-role">
                  {t.interview.targetRole}
                </Label>
                <Input
                  id="interview-target-role"
                  value={settings.targetRole}
                  onChange={(event) =>
                    updateSettings("targetRole", event.target.value)
                  }
                  maxLength={100}
                  required
                  disabled={submitting}
                  aria-invalid={targetRoleError !== null}
                  aria-describedby="interview-target-role-help"
                />
                <p
                  id="interview-target-role-help"
                  className={
                    targetRoleError
                      ? "text-xs text-destructive"
                      : "text-xs text-muted-foreground"
                  }
                >
                  {targetRoleError === "required"
                    ? t.interview.targetRoleRequired
                    : targetRoleError === "too_long"
                      ? t.interview.targetRoleTooLong
                      : t.interview.targetRoleDescription}
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="interview-target-level">
                    {t.interview.targetLevel}
                  </Label>
                  <Select
                    value={settings.targetLevel}
                    onValueChange={(value) =>
                      updateSettings(
                        "targetLevel",
                        value as InterviewSettings["targetLevel"],
                      )
                    }
                    disabled={submitting}
                  >
                    <SelectTrigger
                      id="interview-target-level"
                      className="w-full"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(["Junior", "Mid", "Senior"] as const).map((level) => (
                        <SelectItem key={level} value={level}>
                          {t.interview.levels[level]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="interview-type">
                    {t.interview.interviewType}
                  </Label>
                  <Select
                    value={settings.interviewType}
                    onValueChange={(value) =>
                      updateSettings(
                        "interviewType",
                        value as InterviewSettings["interviewType"],
                      )
                    }
                    disabled={submitting}
                  >
                    <SelectTrigger id="interview-type" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="behavioral">
                        {t.interview.behavioral}
                      </SelectItem>
                      <SelectItem value="technical">
                        {t.interview.technical}
                      </SelectItem>
                      <SelectItem value="mixed">{t.interview.mixed}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="interview-language">
                    {t.interview.language}
                  </Label>
                  <Select
                    value={settings.language}
                    onValueChange={(value) =>
                      updateSettings(
                        "language",
                        value as InterviewSettings["language"],
                      )
                    }
                    disabled={submitting}
                  >
                    <SelectTrigger id="interview-language" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(["zh", "en", "es", "de"] as const).map((language) => (
                        <SelectItem key={language} value={language}>
                          {t.interview.languages[language]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="interview-question-count">
                    {t.interview.questionCount}
                  </Label>
                  <Input
                    id="interview-question-count"
                    type="number"
                    min={1}
                    max={20}
                    value={settings.targetRoundCount}
                    onChange={(event) =>
                      updateSettings(
                        "targetRoundCount",
                        Number(event.target.value),
                      )
                    }
                    disabled={submitting}
                    required
                  />
                </div>
              </div>

              <fieldset className="space-y-3">
                <legend className="text-sm font-medium">
                  {t.interview.persona}
                </legend>
                <div className="grid gap-2.5 sm:grid-cols-3">
                  {PERSONAS.map((persona) => {
                    const selected = settings.persona === persona;
                    return (
                      <button
                        key={persona}
                        type="button"
                        aria-pressed={selected}
                        disabled={submitting}
                        onClick={() => updateSettings("persona", persona)}
                        className={cn(
                          "group relative flex flex-col justify-between rounded-xl border p-3.5 text-left transition-all outline-none cursor-pointer",
                          "hover:bg-muted/40 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
                          "disabled:pointer-events-none disabled:opacity-50",
                          selected
                            ? "border-primary bg-primary/[0.06] shadow-xs ring-1 ring-primary/30"
                            : "border-border/70 bg-card hover:border-border hover:bg-muted/30",
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={cn(
                              "block text-sm font-medium transition-colors",
                              selected
                                ? "font-semibold text-primary"
                                : "text-foreground",
                            )}
                          >
                            {t.interview.personas[persona].label}
                          </span>
                          {selected ? (
                            <span className="flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xs">
                              <Check className="size-2.5 stroke-[3]" />
                            </span>
                          ) : (
                            <span className="size-4 rounded-full border border-border/80 transition-colors group-hover:border-muted-foreground/40" />
                          )}
                        </div>
                        <span className="mt-2 block text-xs leading-relaxed text-muted-foreground">
                          {t.interview.personas[persona].description}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-sm font-medium">{t.interview.preference}</Label>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {t.interview.preferenceDescription}
                    </p>
                  </div>
                  {settings.preferenceTags.length > 0 && (
                    <span className="text-xs text-muted-foreground tabular-nums">
                      已选 {settings.preferenceTags.length}/3
                    </span>
                  )}
                </div>
                <div
                  className="flex flex-wrap gap-2"
                  role="group"
                  aria-label={t.interview.preference}
                >
                  {PREFERENCE_TAGS.map((tag) => {
                    const label = t.interview.preferenceTags[tag];
                    const selected =
                      settings.preferenceTags.includes(label) ||
                      settings.preferenceTags.includes(tag);
                    return (
                      <button
                        key={tag}
                        type="button"
                        aria-pressed={selected}
                        disabled={submitting}
                        onClick={() => togglePreferenceTag(label, tag)}
                        className={cn(
                          "group inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition-all outline-none cursor-pointer select-none",
                          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                          "disabled:pointer-events-none disabled:opacity-50",
                          selected
                            ? "border border-primary/50 bg-primary/10 text-primary shadow-xs ring-1 ring-primary/30 hover:bg-primary/15 hover:border-primary/70"
                            : "border border-border/80 bg-background text-muted-foreground hover:border-muted-foreground/30 hover:bg-muted/50 hover:text-foreground",
                        )}
                      >
                        {selected ? (
                          <Check className="size-3.5 shrink-0 text-primary stroke-[2.5] transition-transform duration-200" />
                        ) : (
                          <Plus className="size-3.5 shrink-0 text-muted-foreground/60 transition-transform duration-200 group-hover:text-foreground" />
                        )}
                        <span>{label}</span>
                      </button>
                    );
                  })}
                </div>
                <Textarea
                  value={settings.preference}
                  onChange={(event) =>
                    updateSettings("preference", event.target.value)
                  }
                  placeholder={t.interview.preferencePlaceholder}
                  maxLength={1_000}
                  disabled={submitting}
                  className="min-h-24 resize-y"
                  aria-label={t.interview.preference}
                />
              </div>

              {error ? (
                <p
                  role="alert"
                  className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
                >
                  {error}
                </p>
              ) : null}
            </div>
          )}

          <DialogFooter className="shrink-0 border-t px-6 py-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={submitting}
            >
              {t.common.cancel}
            </Button>
            <Button
              type="submit"
              disabled={targetRoleError !== null || submitting}
            >
              {submitting ? <Loader2 className="animate-spin" /> : null}
              {submitting
                ? mode === "settings"
                  ? t.interview.savingSettings
                  : t.interview.creatingInterview
                : mode === "settings"
                  ? t.interview.saveSettings
                  : t.interview.createInterview}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
