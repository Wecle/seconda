"use client";

import { useRef, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
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
import {
  InterviewCreationClientError,
  requestInterviewCreation,
  resetInterviewCreationAttempt,
  resolveInterviewCreationAttempt,
  validateInterviewTargetRole,
  type InterviewCreationAttempt,
  type InterviewCreationResponse,
} from "@/lib/interview/client/create-interview";
import { cn } from "@/lib/utils";

type InterviewSettings = Omit<CreateInterviewRequest, "resumeVersionId">;

const PERSONAS = ["friendly", "standard", "stressful"] as const;
const PREFERENCE_TAGS = [
  "project_deep_dive",
  "technical_foundations",
  "behavioral_evidence",
] as const;

interface InterviewSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resumeVersionId: string;
  defaultTargetRole: string;
}

export function InterviewSettingsDialog({
  open,
  onOpenChange,
  resumeVersionId,
  defaultTargetRole,
}: InterviewSettingsDialogProps) {
  const { locale, t } = useTranslation();
  const [settings, setSettings] = useState<InterviewSettings>(() => ({
    language: locale,
    persona: "standard",
    interviewType: "mixed",
    targetLevel: "Mid",
    targetRole: defaultTargetRole.trim(),
    preference: "",
    preferenceTags: [],
    targetRoundCount: 8,
  }));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creation, setCreation] = useState<InterviewCreationResponse | null>(null);
  const creationAttempt = useRef<InterviewCreationAttempt | null>(null);
  const targetRoleError = validateInterviewTargetRole(settings.targetRole);

  const updateSettings = <Key extends keyof InterviewSettings>(
    key: Key,
    value: InterviewSettings[Key],
  ) => {
    setSettings((current) => ({ ...current, [key]: value }));
    setError(null);
  };

  const togglePreferenceTag = (tag: string) => {
    updateSettings(
      "preferenceTags",
      settings.preferenceTags.includes(tag)
        ? settings.preferenceTags.filter((current) => current !== tag)
        : [...settings.preferenceTags, tag].slice(0, 3),
    );
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && submitting) return;
    onOpenChange(nextOpen);
    if (!nextOpen) {
      setError(null);
      setCreation(null);
      creationAttempt.current = resetInterviewCreationAttempt();
    }
  };

  const handleSubmit = async () => {
    if (targetRoleError || submitting) return;
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
      setCreation(await requestInterviewCreation({
        idempotencyKey: creationAttempt.current.idempotencyKey,
        request,
      }));
    } catch (cause) {
      if (
        cause instanceof InterviewCreationClientError
        && cause.code === "INTERVIEW_IDEMPOTENCY_CONFLICT"
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
        {creation ? (
          <div className="space-y-6 p-6 sm:p-8">
            <DialogHeader className="items-center text-center sm:text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
                <CheckCircle2 className="size-6" />
              </div>
              <DialogTitle className="text-xl">
                {t.interview.creationSucceeded}
              </DialogTitle>
              <DialogDescription className="max-w-md leading-6">
                {t.interview.creationSucceededDescription}
              </DialogDescription>
            </DialogHeader>
            <dl className="grid gap-3 rounded-lg border bg-muted/30 p-4 text-sm">
              <div className="grid gap-1 sm:grid-cols-[8rem_1fr] sm:items-center">
                <dt className="text-muted-foreground">{t.interview.interviewId}</dt>
                <dd className="break-all font-mono text-xs">{creation.interviewId}</dd>
              </div>
              <div className="grid gap-1 sm:grid-cols-[8rem_1fr] sm:items-center">
                <dt className="text-muted-foreground">{t.interview.creationStatus}</dt>
                <dd className="font-medium">{t.interview.statusActive}</dd>
              </div>
            </dl>
            <div className="space-y-2 rounded-lg border bg-background p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t.interview.firstQuestion}
              </p>
              <p className="leading-7">{creation.question.question}</p>
              {creation.question.tip ? (
                <p className="text-sm text-muted-foreground">
                  {t.interview.tip}: {creation.question.tip}
                </p>
              ) : null}
            </div>
            <DialogFooter>
              <Button type="button" onClick={() => handleOpenChange(false)}>
                {t.common.close}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            className="flex min-h-0 flex-col"
            onSubmit={(event) => {
              event.preventDefault();
              void handleSubmit();
            }}
          >
            <div className="shrink-0 border-b px-6 py-5">
              <DialogHeader className="pr-8">
                <DialogTitle>{t.interview.settingsTitle}</DialogTitle>
                <DialogDescription className="leading-5">
                  {t.interview.settingsDescription}
                </DialogDescription>
              </DialogHeader>
            </div>

            <div className="min-h-0 space-y-6 overflow-y-auto px-6 py-5">
              <div className="space-y-2">
                <Label htmlFor="interview-target-role">{t.interview.targetRole}</Label>
                <Input
                  id="interview-target-role"
                  value={settings.targetRole}
                  onChange={(event) => updateSettings("targetRole", event.target.value)}
                  maxLength={100}
                  required
                  disabled={submitting}
                  aria-invalid={targetRoleError !== null}
                  aria-describedby="interview-target-role-help"
                />
                <p
                  id="interview-target-role-help"
                  className={targetRoleError ? "text-xs text-destructive" : "text-xs text-muted-foreground"}
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
                  <Label htmlFor="interview-target-level">{t.interview.targetLevel}</Label>
                  <Select
                    value={settings.targetLevel}
                    onValueChange={(value) => updateSettings("targetLevel", value as InterviewSettings["targetLevel"])}
                    disabled={submitting}
                  >
                    <SelectTrigger id="interview-target-level" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(["Junior", "Mid", "Senior"] as const).map((level) => (
                        <SelectItem key={level} value={level}>{t.interview.levels[level]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="interview-type">{t.interview.interviewType}</Label>
                  <Select
                    value={settings.interviewType}
                    onValueChange={(value) => updateSettings("interviewType", value as InterviewSettings["interviewType"])}
                    disabled={submitting}
                  >
                    <SelectTrigger id="interview-type" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="behavioral">{t.interview.behavioral}</SelectItem>
                      <SelectItem value="technical">{t.interview.technical}</SelectItem>
                      <SelectItem value="mixed">{t.interview.mixed}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="interview-language">{t.interview.language}</Label>
                  <Select
                    value={settings.language}
                    onValueChange={(value) => updateSettings("language", value as InterviewSettings["language"])}
                    disabled={submitting}
                  >
                    <SelectTrigger id="interview-language" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(["zh", "en", "es", "de"] as const).map((language) => (
                        <SelectItem key={language} value={language}>{t.interview.languages[language]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="interview-question-count">{t.interview.questionCount}</Label>
                  <Input
                    id="interview-question-count"
                    type="number"
                    min={1}
                    max={20}
                    value={settings.targetRoundCount}
                    onChange={(event) => updateSettings("targetRoundCount", Number(event.target.value))}
                    disabled={submitting}
                    required
                  />
                </div>
              </div>

              <fieldset className="space-y-3">
                <legend className="text-sm font-medium">{t.interview.persona}</legend>
                <div className="grid gap-2 sm:grid-cols-3">
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
                          "rounded-lg border p-3 text-left transition-colors outline-none",
                          "hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
                          "disabled:pointer-events-none disabled:opacity-50",
                          selected && "border-primary bg-primary/5",
                        )}
                      >
                        <span className="block text-sm font-medium">
                          {t.interview.personas[persona].label}
                        </span>
                        <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                          {t.interview.personas[persona].description}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              <div className="space-y-3">
                <div>
                  <Label>{t.interview.preference}</Label>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t.interview.preferenceDescription}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2" role="group" aria-label={t.interview.preference}>
                  {PREFERENCE_TAGS.map((tag) => {
                    const label = t.interview.preferenceTags[tag];
                    const selected = settings.preferenceTags.includes(label);
                    return (
                      <Button
                        key={tag}
                        type="button"
                        size="sm"
                        variant={selected ? "secondary" : "outline"}
                        aria-pressed={selected}
                        disabled={submitting}
                        onClick={() => togglePreferenceTag(label)}
                      >
                        {label}
                      </Button>
                    );
                  })}
                </div>
                <Textarea
                  value={settings.preference}
                  onChange={(event) => updateSettings("preference", event.target.value)}
                  placeholder={t.interview.preferencePlaceholder}
                  maxLength={1_000}
                  disabled={submitting}
                  className="min-h-24 resize-y"
                  aria-label={t.interview.preference}
                />
              </div>

              {error ? (
                <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              ) : null}
            </div>

            <DialogFooter className="shrink-0 border-t px-6 py-4">
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={submitting}>
                {t.common.cancel}
              </Button>
              <Button type="submit" disabled={targetRoleError !== null || submitting}>
                {submitting ? <Loader2 className="animate-spin" /> : null}
                {submitting ? t.interview.creatingInterview : t.interview.createInterview}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
