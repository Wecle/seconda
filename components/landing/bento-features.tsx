"use client";

import { useState } from "react";
import {
  FileText,
  Brain,
  MessageSquareCode,
  Sliders,
  Sparkles,
  ShieldCheck,
  BrainCircuit,
  ChevronDown,
  Check,
} from "lucide-react";
import { useTranslation } from "@/lib/i18n/context";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function BentoFeatures() {
  const { t } = useTranslation();
  const bento = t.landing.bento;

  // State for interactive persona card
  const [selectedPersona, setSelectedPersona] = useState<"friendly" | "standard" | "stressful">("standard");
  const [selectedTag, setSelectedTag] = useState<"project_deep_dive" | "technical_foundations" | "behavioral_evidence">("project_deep_dive");

  const personas = bento.card4.personas;

  return (
    <section id="features" className="py-24 sm:py-32 relative">
      <div className="mx-auto max-w-6xl px-6">
        {/* Section Header */}
        <div className="mx-auto max-w-3xl text-center mb-16 sm:mb-20">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/[0.05] px-3.5 py-1 text-xs font-semibold text-primary mb-4">
            <Sparkles className="size-3.5" />
            <span>{bento.badge}</span>
          </div>
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl lg:text-5xl text-balance">
            {bento.title}
          </h2>
          <p className="mt-4 text-base sm:text-lg text-muted-foreground leading-relaxed text-balance">
            {bento.subtitle}
          </p>
        </div>

        {/* Asymmetric Bento Grid */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
          {/* Card 1: Real Resume Fact Grounding & Preview (7 Cols) */}
          <div className="group relative md:col-span-7 flex flex-col justify-between overflow-hidden rounded-2xl border border-border/80 bg-card p-6 sm:p-8 transition-all duration-300 hover:border-primary/40 hover:shadow-xl">
            <div>
              <div className="flex items-center justify-between mb-4">
                <span className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                  <FileText className="size-3.5" />
                  <span>{bento.card1.tag}</span>
                </span>
                <Badge variant="outline" className="text-[11px] font-mono">
                  {bento.card1.badge}
                </Badge>
              </div>
              <h3 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
                {bento.card1.title}
              </h3>
              <p className="mt-2 text-sm sm:text-base text-muted-foreground leading-relaxed">
                {bento.card1.description}
              </p>
            </div>

            {/* Real UI Replica: Parsed Resume Card + Extracted Fact Keywords */}
            <div className="mt-6 rounded-xl border border-border/80 bg-muted/20 p-4 sm:p-5 space-y-3">
              <div className="flex items-start justify-between pb-3 border-b border-border/60">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-foreground">{bento.card1.candidateName}</span>
                    <Badge variant="secondary" className="text-[10px] bg-primary/10 text-primary">
                      {bento.card1.parsedSuccess}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {bento.card1.candidateExp}
                  </p>
                </div>
                <div className="flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold bg-emerald-500/10 px-2 py-0.5 rounded">
                  <ShieldCheck className="size-3.5" />
                  <span>{bento.card1.verifiedFacts}</span>
                </div>
              </div>

              {/* Parsed Experience Bullet with Keyword Marks */}
              <div className="rounded-lg bg-background p-3 text-xs leading-relaxed border border-border/60 space-y-1.5">
                <div className="flex justify-between items-center text-[11px] text-muted-foreground font-medium">
                  <span className="font-semibold text-foreground">{bento.card1.company}</span>
                  <span className="font-mono">{bento.card1.period}</span>
                </div>
                <p className="text-muted-foreground text-xs">
                  {bento.card1.bulletPrefix}
                  <mark className="rounded-xs bg-amber-200/80 dark:bg-amber-500/30 px-1 py-0.5 text-foreground font-medium mx-1">
                    {bento.card1.bulletKeyword1}
                  </mark>
                  {bento.card1.bulletMiddle}
                  <mark className="rounded-xs bg-amber-200/80 dark:bg-amber-500/30 px-1 py-0.5 text-foreground font-medium mx-1">
                    {bento.card1.bulletKeyword2}
                  </mark>
                  {bento.card1.bulletSuffix}
                </p>
              </div>

              {/* Bottom Generated Prompt */}
              <div className="rounded-lg bg-primary/[0.04] p-3 text-xs border border-primary/20 text-foreground">
                <span className="font-semibold text-primary">{bento.card1.targetedQuestionLabel} </span>
                {bento.card1.previewQuestion}
              </div>
            </div>
          </div>

          {/* Card 2: Real 6-Dimension Score Cards (5 Cols) */}
          <div className="group relative md:col-span-5 flex flex-col justify-between overflow-hidden rounded-2xl border border-border/80 bg-card p-6 sm:p-8 transition-all duration-300 hover:border-primary/40 hover:shadow-xl">
            <div>
              <div className="flex items-center justify-between mb-4">
                <span className="inline-flex items-center gap-1.5 rounded-md bg-blue-500/10 px-2.5 py-1 text-xs font-semibold text-blue-600 dark:text-blue-400">
                  <Brain className="size-3.5" />
                  <span>{bento.card2.tag}</span>
                </span>
                <span className="text-xs text-muted-foreground font-mono">{bento.card2.equalWeight}</span>
              </div>
              <h3 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
                {bento.card2.title}
              </h3>
              <p className="mt-2 text-sm sm:text-base text-muted-foreground leading-relaxed">
                {bento.card2.description}
              </p>
            </div>

            {/* Real Report View Mini Cards */}
            <div className="mt-6 space-y-2.5">
              {[
                { name: bento.card2.dimUnderstanding, score: "9.2", grade: t.report.strongPerformer, color: "text-emerald-600 dark:text-emerald-400", width: "92%" },
                { name: bento.card2.dimLogic, score: "9.0", grade: t.report.strongPerformer, color: "text-emerald-600 dark:text-emerald-400", width: "90%" },
                { name: bento.card2.dimDepth, score: "8.5", grade: t.report.strongPerformer, color: "text-emerald-600 dark:text-emerald-400", width: "85%" },
                { name: bento.card2.dimExpression, score: "8.8", grade: t.report.strongPerformer, color: "text-emerald-600 dark:text-emerald-400", width: "88%" },
              ].map((dim, i) => (
                <div
                  key={i}
                  className="rounded-xl border border-border/80 bg-background p-3 shadow-2xs space-y-1.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-xs text-foreground">{dim.name}</span>
                    <div className="flex items-baseline gap-1">
                      <span className="font-bold text-sm font-mono text-primary">{dim.score}</span>
                      <span className="text-[10px] text-muted-foreground">/ 10</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>{bento.card2.ratingLabel}</span>
                    <span className={`font-medium ${dim.color}`}>{dim.grade}</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full bg-gradient-to-r from-primary/80 to-primary transition-all duration-500"
                      style={{ width: dim.width }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Card 3: Real Reasoning Row & Adaptive Probing (6 Cols) */}
          <div className="group relative md:col-span-6 flex flex-col justify-between overflow-hidden rounded-2xl border border-border/80 bg-card p-6 sm:p-8 transition-all duration-300 hover:border-primary/40 hover:shadow-xl">
            <div>
              <div className="flex items-center justify-between mb-4">
                <span className="inline-flex items-center gap-1.5 rounded-md bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-600 dark:text-amber-400">
                  <MessageSquareCode className="size-3.5" />
                  <span>{bento.card3.tag}</span>
                </span>
                <span className="text-xs text-muted-foreground font-mono">Agent Reasoning</span>
              </div>
              <h3 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
                {bento.card3.title}
              </h3>
              <p className="mt-2 text-sm sm:text-base text-muted-foreground leading-relaxed">
                {bento.card3.description}
              </p>
            </div>

            {/* Real Reasoning Row + Follow-up Card */}
            <div className="mt-6 space-y-3 rounded-xl border border-border/80 bg-muted/20 p-4 sm:p-5">
              {/* Reasoning Row Replica */}
              <div className="flex items-start gap-3">
                <div className="grid size-7 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-muted-foreground/20 to-muted-foreground/10 text-foreground ring-1 ring-border/80">
                  <BrainCircuit className="size-3.5 text-primary" />
                </div>
                <div className="flex-1 overflow-hidden rounded-lg border border-border/70 bg-card px-3 py-1.5 text-xs">
                  <div className="flex items-center justify-between text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <span className="size-1.5 rounded-full bg-primary" />
                      <span className="font-medium text-foreground">{bento.card3.reasoningTitle}</span>
                      <span className="truncate text-[11px]">{bento.card3.reasoningDetail}</span>
                    </div>
                    <ChevronDown className="size-3" />
                  </div>
                </div>
              </div>

              {/* Follow-up Question Bubble */}
              <div className="rounded-xl border border-primary/20 bg-background p-3.5 text-xs space-y-1.5">
                <div className="flex items-center gap-1.5 text-primary font-bold">
                  <Sparkles className="size-3.5" />
                  <span>{bento.card3.followupBadge}</span>
                </div>
                <p className="text-foreground leading-relaxed">
                  {bento.card3.followupText}
                </p>
              </div>
            </div>
          </div>

          {/* Card 4: Real Interview Settings Dialog Replica (6 Cols) */}
          <div className="group relative md:col-span-6 flex flex-col justify-between overflow-hidden rounded-2xl border border-border/80 bg-card p-6 sm:p-8 transition-all duration-300 hover:border-primary/40 hover:shadow-xl">
            <div>
              <div className="flex items-center justify-between mb-4">
                <span className="inline-flex items-center gap-1.5 rounded-md bg-purple-500/10 px-2.5 py-1 text-xs font-semibold text-purple-600 dark:text-purple-400">
                  <Sliders className="size-3.5" />
                  <span>{bento.card4.tag}</span>
                </span>
                <span className="text-xs text-muted-foreground font-mono">Settings Modal</span>
              </div>
              <h3 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
                {bento.card4.title}
              </h3>
              <p className="mt-2 text-sm sm:text-base text-muted-foreground leading-relaxed">
                {bento.card4.description}
              </p>
            </div>

            {/* Real Settings Form Replica */}
            <div className="mt-6 rounded-xl border border-border/80 bg-muted/20 p-4 sm:p-5 space-y-3.5">
              {/* Persona Options Grid */}
              <div>
                <div className="text-xs font-semibold text-foreground mb-1.5">
                  {bento.card4.personaTitle}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {(["friendly", "standard", "stressful"] as const).map((key) => {
                    const p = personas[key];
                    const isSelected = selectedPersona === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setSelectedPersona(key)}
                        className={cn(
                          "flex flex-col items-center justify-center p-2 rounded-lg border text-center transition-all cursor-pointer",
                          isSelected
                            ? "border-primary bg-background shadow-xs text-foreground font-semibold ring-1 ring-primary/40"
                            : "border-border/60 bg-background/60 text-muted-foreground hover:bg-background",
                        )}
                      >
                        <span className="text-xs">{p.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Preference Tags */}
              <div>
                <div className="text-xs font-semibold text-foreground mb-1.5">
                  {bento.card4.focusTitle}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { id: "project_deep_dive", label: t.interview.preferenceTags.project_deep_dive },
                    { id: "technical_foundations", label: t.interview.preferenceTags.technical_foundations },
                    { id: "behavioral_evidence", label: t.interview.preferenceTags.behavioral_evidence },
                  ].map((tag) => {
                    const isSelected = selectedTag === tag.id;
                    return (
                      <button
                        key={tag.id}
                        type="button"
                        onClick={() => setSelectedTag(tag.id as typeof selectedTag)}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs transition-colors cursor-pointer",
                          isSelected
                            ? "bg-primary text-primary-foreground font-medium"
                            : "border border-border bg-background text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {isSelected && <Check className="size-3" />}
                        <span>{tag.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Prompt Output Snippet */}
              <div className="rounded-lg bg-background p-2.5 text-xs text-muted-foreground italic border border-border/60">
                <span className="font-semibold text-foreground not-italic">{bento.card4.promptPreviewLabel} </span>
                {personas[selectedPersona].prompt}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
