"use client";

import type { ReactNode } from "react";
import { AlertCircle, BriefcaseBusiness, Code2, GraduationCap, Loader2, Sparkles, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useTranslation } from "@/lib/i18n/context";
import type { GeneratedResumeDraft } from "@/lib/resume/generation-contract";
import { normalizeSkills } from "@/lib/resume/generation-contract";

interface GeneratedResumeFormProps {
  draft: GeneratedResumeDraft;
  onDraftChange: (draft: GeneratedResumeDraft) => void;
  generating: boolean;
  generateError: string | null;
  onCancel: () => void;
  onGenerate: () => void;
}

interface FieldLabelProps {
  htmlFor: string;
  label: string;
  required?: boolean;
  icon: ReactNode;
}

function FieldLabel({ htmlFor, label, required = false, icon }: FieldLabelProps) {
  const { t } = useTranslation();

  return (
    <div className="flex items-center gap-2">
      <span className="text-primary" aria-hidden="true">
        {icon}
      </span>
      <Label htmlFor={htmlFor} className="text-sm font-semibold">
        {label}
      </Label>
      <span
        className={
          required
            ? "text-xs font-medium text-destructive"
            : "rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground"
        }
      >
        {required ? t.dashboard.generator.required : t.dashboard.generator.optional}
      </span>
    </div>
  );
}

export function GeneratedResumeForm({
  draft,
  onDraftChange,
  generating,
  generateError,
  onCancel,
  onGenerate,
}: GeneratedResumeFormProps) {
  const { t } = useTranslation();
  const skills = normalizeSkills(draft.coreSkills);
  const targetRoleMissing = draft.targetRole.trim().length === 0;
  const coreSkillsMissing = skills.length === 0;
  const cannotGenerate = targetRoleMissing || coreSkillsMissing || generating;

  const updateField = <Key extends keyof GeneratedResumeDraft>(
    field: Key,
    value: GeneratedResumeDraft[Key],
  ) => {
    onDraftChange({ ...draft, [field]: value });
  };

  const appendSkill = (suggestion: string) => {
    const normalizedKey = suggestion.trim().toLowerCase();
    if (skills.some((skill) => skill.toLowerCase() === normalizedKey)) return;
    const nextSkills = [...skills, suggestion].join(", ");
    if (nextSkills.length > 1_000) return;
    updateField("coreSkills", nextSkills);
  };

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        if (!cannotGenerate) onGenerate();
      }}
    >
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5 sm:px-8">
        <div className="mx-auto max-w-4xl space-y-7">
          <div className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
            <div className="rounded-lg bg-primary/10 p-2 text-primary">
              <Sparkles className="size-5" />
            </div>
            <div>
              <h3 className="font-semibold">{t.dashboard.generator.title}</h3>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {t.dashboard.generator.subtitle}
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <FieldLabel
              htmlFor="generated-name"
              label={t.dashboard.generator.name}
              icon={<UserRound className="size-4" />}
            />
            <Input
              id="generated-name"
              value={draft.name}
              onChange={(event) => updateField("name", event.target.value)}
              placeholder={t.dashboard.generator.namePlaceholder}
              maxLength={100}
              disabled={generating}
            />
            <p className="text-xs text-muted-foreground">
              {t.dashboard.generator.nameHelper}
            </p>
          </div>

          <div className="space-y-2">
            <FieldLabel
              htmlFor="generated-target-role"
              label={t.dashboard.generator.targetRole}
              required
              icon={<BriefcaseBusiness className="size-4" />}
            />
            <Input
              id="generated-target-role"
              value={draft.targetRole}
              onChange={(event) => updateField("targetRole", event.target.value)}
              placeholder={t.dashboard.generator.targetRolePlaceholder}
              maxLength={100}
              disabled={generating}
              required
              aria-invalid={targetRoleMissing}
              aria-describedby="generated-target-role-help"
            />
            <div className="flex flex-wrap gap-2" aria-label={t.dashboard.generator.roleSuggestionsLabel}>
              {t.dashboard.generator.roleSuggestions.map((suggestion) => (
                <Button
                  key={suggestion}
                  type="button"
                  variant="secondary"
                  size="xs"
                  className="rounded-full"
                  onClick={() => updateField("targetRole", suggestion)}
                  disabled={generating}
                >
                  {suggestion}
                </Button>
              ))}
            </div>
            <p
              id="generated-target-role-help"
              className={targetRoleMissing ? "text-xs text-destructive" : "text-xs text-muted-foreground"}
            >
              {targetRoleMissing
                ? t.dashboard.generator.targetRoleRequired
                : t.dashboard.generator.targetRoleHelper}
            </p>
          </div>

          <div className="space-y-2">
            <FieldLabel
              htmlFor="generated-core-skills"
              label={t.dashboard.generator.coreSkills}
              required
              icon={<Code2 className="size-4" />}
            />
            <Input
              id="generated-core-skills"
              value={draft.coreSkills}
              onChange={(event) => updateField("coreSkills", event.target.value)}
              placeholder={t.dashboard.generator.coreSkillsPlaceholder}
              maxLength={1_000}
              disabled={generating}
              required
              aria-invalid={coreSkillsMissing}
              aria-describedby="generated-core-skills-help"
            />
            <div className="flex flex-wrap gap-2" aria-label={t.dashboard.generator.skillSuggestionsLabel}>
              {t.dashboard.generator.skillSuggestions.map((suggestion) => (
                <Button
                  key={suggestion}
                  type="button"
                  variant="secondary"
                  size="xs"
                  className="rounded-full"
                  onClick={() => appendSkill(suggestion)}
                  disabled={generating}
                >
                  {suggestion}
                </Button>
              ))}
            </div>
            <p
              id="generated-core-skills-help"
              className={coreSkillsMissing ? "text-xs text-destructive" : "text-xs text-muted-foreground"}
            >
              {coreSkillsMissing
                ? t.dashboard.generator.coreSkillsRequired
                : t.dashboard.generator.coreSkillsHelper}
            </p>
          </div>

          <div className="border-t pt-7">
            <div className="space-y-2">
              <FieldLabel
                htmlFor="generated-education"
                label={t.dashboard.generator.education}
                icon={<GraduationCap className="size-4" />}
              />
              <Textarea
                id="generated-education"
                value={draft.education}
                onChange={(event) => updateField("education", event.target.value)}
                placeholder={t.dashboard.generator.educationPlaceholder}
                maxLength={3_000}
                disabled={generating}
                className="min-h-24 resize-y"
              />
              <p className="text-xs text-muted-foreground">
                {t.dashboard.generator.educationHelper}
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <FieldLabel
              htmlFor="generated-work-experience"
              label={t.dashboard.generator.workExperience}
              icon={<BriefcaseBusiness className="size-4" />}
            />
            <Textarea
              id="generated-work-experience"
              value={draft.workExperience}
              onChange={(event) => updateField("workExperience", event.target.value)}
              placeholder={t.dashboard.generator.workExperiencePlaceholder}
              maxLength={5_000}
              disabled={generating}
              className="min-h-28 resize-y"
            />
            <p className="text-xs text-muted-foreground">
              {t.dashboard.generator.workExperienceHelper}
            </p>
          </div>

          <div className="space-y-2">
            <FieldLabel
              htmlFor="generated-additional-info"
              label={t.dashboard.generator.additionalInfo}
              icon={<Sparkles className="size-4" />}
            />
            <Textarea
              id="generated-additional-info"
              value={draft.additionalInfo}
              onChange={(event) => updateField("additionalInfo", event.target.value)}
              placeholder={t.dashboard.generator.additionalInfoPlaceholder}
              maxLength={5_000}
              disabled={generating}
              className="min-h-28 resize-y"
            />
            <p className="text-xs text-muted-foreground">
              {t.dashboard.generator.additionalInfoHelper}
            </p>
          </div>

          {generateError ? (
            <div
              role="alert"
              className="flex items-center gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive"
            >
              <AlertCircle className="size-4 shrink-0" />
              {generateError}
            </div>
          ) : null}
        </div>
      </div>

      <div className="sticky bottom-0 z-10 flex shrink-0 items-center justify-between gap-4 border-t bg-background/95 px-6 py-4 backdrop-blur supports-[backdrop-filter]:bg-background/85 sm:px-8">
        <p className="hidden text-sm text-muted-foreground sm:block">
          {t.dashboard.generator.footerHint}
        </p>
        <div className="ml-auto flex gap-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={generating}>
            {t.dashboard.generator.cancel}
          </Button>
          <Button type="submit" disabled={cannotGenerate}>
            {generating ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                {t.dashboard.generator.generating}
              </>
            ) : (
              <>
                <Sparkles className="size-4" />
                {t.dashboard.generator.generate}
              </>
            )}
          </Button>
        </div>
      </div>
    </form>
  );
}
