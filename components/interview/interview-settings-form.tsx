"use client";

import { Gavel, Globe, Smile, Timer } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n/context";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type {
  InterviewConfigV2,
  InterviewLanguage,
  InterviewPersona,
  InterviewPreferenceTag,
} from "@/lib/interview/settings";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const languages: InterviewLanguage[] = ["en", "zh", "es", "de"];
const personas: Array<{ id: InterviewPersona; icon: typeof Smile; color: string }> = [
  { id: "friendly", icon: Smile, color: "bg-green-100 text-green-600 dark:bg-green-900/40 dark:text-green-400" },
  { id: "standard", icon: Gavel, color: "bg-slate-100 text-slate-600 dark:bg-slate-800/60 dark:text-slate-400" },
  { id: "stressful", icon: Timer, color: "bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400" },
];
const preferenceTags: InterviewPreferenceTag[] = [
  "project_deep_dive",
  "technical_foundations",
  "behavioral_evidence",
];

export function InterviewSettingsForm({ value, onChange }: {
  value: InterviewConfigV2;
  onChange: (next: InterviewConfigV2) => void;
}) {
  const { t } = useTranslation();
  const languageLabels = t.interview.languages;
  const personaLabels = t.interview.personas;
  const tagLabels = t.interview.preferenceTags;

  const toggleTag = (tag: InterviewPreferenceTag) => {
    const selected = value.preferenceTags.includes(tag);
    onChange({
      ...value,
      preferenceTags: selected
        ? value.preferenceTags.filter((item) => item !== tag)
        : [...value.preferenceTags, tag],
    });
  };

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <Label className="text-muted-foreground">{t.interview.language}</Label>
        <Select value={value.language} onValueChange={(language: InterviewLanguage) => onChange({ ...value, language })}>
          <SelectTrigger className="w-full"><SelectValue><Globe className="size-4 text-muted-foreground" />{languageLabels[value.language]}</SelectValue></SelectTrigger>
          <SelectContent>{languages.map((language) => <SelectItem key={language} value={language}>{languageLabels[language]}</SelectItem>)}</SelectContent>
        </Select>
      </section>

      <section className="space-y-3">
        <Label className="text-muted-foreground">{t.interview.persona}</Label>
        <div className="grid grid-cols-3 gap-3">
          {personas.map((persona) => (
            <button key={persona.id} type="button" onClick={() => onChange({ ...value, persona: persona.id })}
              className={cn("flex flex-col items-start gap-2 rounded-xl border bg-card p-4 text-left transition-all hover:shadow-sm", value.persona === persona.id ? "border-primary ring-1 ring-primary/20" : "border-border")}>
              <div className={cn("flex size-9 items-center justify-center rounded-full", persona.color)}><persona.icon className="size-4" /></div>
              <div><span className="text-sm font-medium">{personaLabels[persona.id].label}</span><p className="mt-0.5 text-xs leading-snug text-muted-foreground">{personaLabels[persona.id].description}</p></div>
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <div><Label className="text-muted-foreground">{t.interview.preference}</Label><p className="mt-1 text-xs text-muted-foreground">{t.interview.preferenceDescription}</p></div>
        <div className="flex flex-wrap gap-2">
          {preferenceTags.map((tag) => <button key={tag} type="button" onClick={() => toggleTag(tag)} className={cn("rounded-full border px-3 py-1.5 text-sm transition-colors", value.preferenceTags.includes(tag) ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted")}>{tagLabels[tag]}</button>)}
        </div>
        <Textarea value={value.preference} maxLength={1000} rows={4} placeholder={t.interview.preferencePlaceholder} onChange={(event) => onChange({ ...value, preference: event.target.value })} />
        <p className="text-right text-xs text-muted-foreground">{value.preference.length}/1000</p>
      </section>
    </div>
  );
}
