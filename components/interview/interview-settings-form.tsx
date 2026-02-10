"use client";

import { Brain, Code, Gavel, Globe, Merge, Smile, Timer } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n/context";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import type {
  InterviewConfig,
  InterviewLanguage,
  InterviewLevel,
  InterviewPersona,
  InterviewType,
} from "@/lib/interview/settings";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const levels: readonly InterviewLevel[] = ["Junior", "Mid", "Senior"];
const interviewTypes = [
  {
    id: "behavioral" as InterviewType,
    icon: Brain,
    color: "bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400",
  },
  {
    id: "technical" as InterviewType,
    icon: Code,
    color:
      "bg-purple-100 text-purple-600 dark:bg-purple-900/40 dark:text-purple-400",
  },
  {
    id: "mixed" as InterviewType,
    icon: Merge,
    color: "bg-teal-100 text-teal-600 dark:bg-teal-900/40 dark:text-teal-400",
  },
] as const;
const interviewLanguages = [
  { id: "en" as InterviewLanguage },
  { id: "zh" as InterviewLanguage },
  { id: "es" as InterviewLanguage },
  { id: "de" as InterviewLanguage },
] as const;
const personas = [
  {
    id: "friendly" as InterviewPersona,
    icon: Smile,
    color:
      "bg-green-100 text-green-600 dark:bg-green-900/40 dark:text-green-400",
  },
  {
    id: "standard" as InterviewPersona,
    icon: Gavel,
    color:
      "bg-slate-100 text-slate-600 dark:bg-slate-800/60 dark:text-slate-400",
  },
  {
    id: "stressful" as InterviewPersona,
    icon: Timer,
    color: "bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400",
  },
] as const;
const sliderSteps = [5, 10, 15, 20, 25, 30];

interface InterviewSettingsFormProps {
  value: InterviewConfig;
  onChange: (next: InterviewConfig) => void;
}

export function InterviewSettingsForm({
  value,
  onChange,
}: InterviewSettingsFormProps) {
  const { t } = useTranslation();

  const levelLabels: Record<string, string> = {
    Junior: t.interview.levels.Junior,
    Mid: t.interview.levels.Mid,
    Senior: t.interview.levels.Senior,
  };

  const typeLabels: Record<string, string> = {
    behavioral: t.interview.behavioral,
    technical: t.interview.technical,
    mixed: t.interview.mixed,
  };

  const languageLabels: Record<string, string> = {
    en: t.interview.languages.en,
    zh: t.interview.languages.zh,
    es: t.interview.languages.es,
    de: t.interview.languages.de,
  };

  const personaLabels: Record<string, { label: string; description: string }> = {
    friendly: t.interview.personas.friendly,
    standard: t.interview.personas.standard,
    stressful: t.interview.personas.stressful,
  };

  const activeLanguageLabel = languageLabels[value.language] ?? languageLabels.en;

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <Label className="text-muted-foreground">{t.interview.targetLevel}</Label>
        <div className="inline-flex rounded-lg bg-muted p-1">
          {levels.map((level) => (
            <label key={level} className="cursor-pointer">
              <input
                type="radio"
                name="interview-level"
                value={level}
                checked={value.level === level}
                onChange={() => onChange({ ...value, level })}
                className="sr-only peer"
              />
              <span
                className={cn(
                  "inline-flex items-center rounded-md px-4 py-1.5 text-sm font-medium transition-all",
                  "peer-checked:bg-card peer-checked:shadow-sm",
                  value.level !== level && "text-muted-foreground",
                )}
              >
                {levelLabels[level] ?? level}
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <Label className="text-muted-foreground">{t.interview.interviewType}</Label>
        <div className="grid grid-cols-3 gap-3">
          {interviewTypes.map((type) => (
            <button
              key={type.id}
              type="button"
              onClick={() => onChange({ ...value, type: type.id })}
              className={cn(
                "flex flex-col items-center gap-2.5 rounded-xl border bg-card p-4 transition-all hover:shadow-sm",
                value.type === type.id
                  ? "border-primary ring-1 ring-primary/20"
                  : "border-border",
              )}
            >
              <div
                className={cn(
                  "flex size-10 items-center justify-center rounded-full",
                  type.color,
                )}
              >
                <type.icon className="size-5" />
              </div>
              <span className="text-sm font-medium">{typeLabels[type.id]}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="grid grid-cols-2 gap-5">
        <div className="space-y-2">
          <Label className="text-muted-foreground">{t.interview.language}</Label>
          <Select
            value={value.language}
            onValueChange={(language: InterviewLanguage) =>
              onChange({ ...value, language })
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue>
                <Globe className="size-4 text-muted-foreground" />
                {activeLanguageLabel}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {interviewLanguages.map((language) => (
                <SelectItem key={language.id} value={language.id}>
                  {languageLabels[language.id]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-muted-foreground">{t.interview.questionCount}</Label>
            <Badge variant="secondary" className="tabular-nums">
              {value.questionCount} {t.interview.questionsUnit}
            </Badge>
          </div>
          <Slider
            min={5}
            max={30}
            step={1}
            value={[value.questionCount]}
            onValueChange={([questionCount]) =>
              onChange({ ...value, questionCount })
            }
            className="mt-2"
          />
          <div className="mt-1 flex justify-between px-0.5">
            {sliderSteps.map((step) => (
              <span
                key={step}
                className="text-[10px] text-muted-foreground tabular-nums"
              >
                {step}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <Label className="text-muted-foreground">{t.interview.persona}</Label>
        <div className="grid grid-cols-3 gap-3">
          {personas.map((persona) => (
            <button
              key={persona.id}
              type="button"
              onClick={() => onChange({ ...value, persona: persona.id })}
              className={cn(
                "flex flex-col items-start gap-2 rounded-xl border bg-card p-4 text-left transition-all hover:shadow-sm",
                value.persona === persona.id
                  ? "border-primary ring-1 ring-primary/20"
                  : "border-border",
              )}
            >
              <div
                className={cn(
                  "flex size-9 items-center justify-center rounded-full",
                  persona.color,
                )}
              >
                <persona.icon className="size-4" />
              </div>
              <div>
                <span className="text-sm font-medium">{personaLabels[persona.id].label}</span>
                <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                  {personaLabels[persona.id].description}
                </p>
              </div>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
