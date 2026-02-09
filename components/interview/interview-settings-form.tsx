"use client";

import { Brain, Code, Gavel, Globe, Merge, Smile, Timer } from "lucide-react";
import { cn } from "@/lib/utils";
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
    label: "Behavioral",
    icon: Brain,
    color: "bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400",
  },
  {
    id: "technical" as InterviewType,
    label: "Technical",
    icon: Code,
    color:
      "bg-purple-100 text-purple-600 dark:bg-purple-900/40 dark:text-purple-400",
  },
  {
    id: "mixed" as InterviewType,
    label: "Mixed",
    icon: Merge,
    color: "bg-teal-100 text-teal-600 dark:bg-teal-900/40 dark:text-teal-400",
  },
] as const;
const interviewLanguages = [
  { id: "en" as InterviewLanguage, label: "English" },
  { id: "zh" as InterviewLanguage, label: "Chinese" },
  { id: "es" as InterviewLanguage, label: "Spanish" },
  { id: "de" as InterviewLanguage, label: "German" },
] as const;
const personas = [
  {
    id: "friendly" as InterviewPersona,
    label: "Friendly",
    description: "Warm and encouraging, helps you feel comfortable.",
    icon: Smile,
    color:
      "bg-green-100 text-green-600 dark:bg-green-900/40 dark:text-green-400",
  },
  {
    id: "standard" as InterviewPersona,
    label: "Standard",
    description: "Professional and balanced, mirrors real interviews.",
    icon: Gavel,
    color:
      "bg-slate-100 text-slate-600 dark:bg-slate-800/60 dark:text-slate-400",
  },
  {
    id: "stressful" as InterviewPersona,
    label: "Stressful",
    description: "High-pressure, tests how you handle tough questions.",
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
  const activeLanguageLabel =
    interviewLanguages.find((language) => language.id === value.language)
      ?.label ?? "English";

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <Label className="text-muted-foreground">Target Level</Label>
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
                {level}
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <Label className="text-muted-foreground">Interview Type</Label>
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
              <span className="text-sm font-medium">{type.label}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="grid grid-cols-2 gap-5">
        <div className="space-y-2">
          <Label className="text-muted-foreground">Language</Label>
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
                  {language.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-muted-foreground">Question Count</Label>
            <Badge variant="secondary" className="tabular-nums">
              {value.questionCount} Questions
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
        <Label className="text-muted-foreground">Interviewer Persona</Label>
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
                <span className="text-sm font-medium">{persona.label}</span>
                <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                  {persona.description}
                </p>
              </div>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
