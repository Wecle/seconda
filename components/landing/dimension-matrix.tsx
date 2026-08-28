"use client";

import { useState } from "react";
import {
  CheckCircle2,
  TrendingUp,
  Award,
  Layers,
  Compass,
  MessageSquare,
  Network,
  Cpu,
  History,
  GraduationCap,
} from "lucide-react";
import { useTranslation } from "@/lib/i18n/context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const DIMENSION_ICONS_AND_STYLES: Record<string, { icon: typeof Compass; gradeColor: string }> = {
  understanding: {
    icon: Compass,
    gradeColor: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  },
  expression: {
    icon: MessageSquare,
    gradeColor: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  },
  logic: {
    icon: Network,
    gradeColor: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  },
  depth: {
    icon: Cpu,
    gradeColor: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  },
  authenticity: {
    icon: Layers,
    gradeColor: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  },
  reflection: {
    icon: History,
    gradeColor: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  },
};

export function DimensionMatrix() {
  const { t, locale } = useTranslation();
  const dimData = t.landing.dimensions;
  const [selectedKey, setSelectedKey] = useState<string>("understanding");

  const activeDim = dimData.items.find((item) => item.key === selectedKey) || dimData.items[0];
  const activeMeta = DIMENSION_ICONS_AND_STYLES[activeDim.key] || DIMENSION_ICONS_AND_STYLES.understanding;
  const ActiveIcon = activeMeta.icon;

  return (
    <section className="py-24 sm:py-32 relative overflow-hidden bg-muted/20 border-y border-border/60">
      <div className="mx-auto max-w-6xl px-6">
        {/* Section Header */}
        <div className="mx-auto max-w-3xl text-center mb-16 sm:mb-20">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/[0.05] px-3.5 py-1 text-xs font-semibold text-primary mb-4">
            <Award className="size-3.5" />
            <span>{dimData.badge}</span>
          </div>
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl lg:text-5xl text-balance">
            {dimData.title}
          </h2>
          <p className="mt-4 text-base sm:text-lg text-muted-foreground leading-relaxed text-balance">
            {dimData.subtitle}
          </p>
        </div>

        {/* Real Dimension Matrix Workspace */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left: 6 Dimension Cards (Exact Real UI Replica) (6 Cols) */}
          <div className="lg:col-span-6 grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {dimData.items.map((item) => {
              const meta = DIMENSION_ICONS_AND_STYLES[item.key] || DIMENSION_ICONS_AND_STYLES.understanding;
              const Icon = meta.icon;
              const isSelected = selectedKey === item.key;
              const percent = Math.round(item.score * 10);
              const label = locale === "zh" ? item.name : item.enName;

              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setSelectedKey(item.key)}
                  className={cn(
                    "flex flex-col justify-between p-4 rounded-xl border text-left transition-all duration-200 cursor-pointer",
                    isSelected
                      ? "border-primary bg-card shadow-md ring-1 ring-primary/40 -translate-y-0.5"
                      : "border-border/80 bg-card/70 hover:bg-card hover:border-border",
                  )}
                >
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <div
                          className={cn(
                            "flex size-7 items-center justify-center rounded-lg transition-colors",
                            isSelected
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-muted-foreground",
                          )}
                        >
                          <Icon className="size-3.5" />
                        </div>
                        <span className="font-semibold text-sm text-foreground">
                          {label}
                        </span>
                      </div>
                      <div className="flex items-baseline gap-0.5">
                        <span className="font-mono text-sm font-bold text-primary">
                          {item.score.toFixed(1)}
                        </span>
                        <span className="text-[10px] text-muted-foreground">/ 10</span>
                      </div>
                    </div>

                    <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
                      {item.desc}
                    </p>
                  </div>

                  <div className="mt-3.5 pt-2 border-t border-border/40">
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
                      <span>{dimData.ratingLabel}</span>
                      <span className="font-medium text-emerald-600 dark:text-emerald-400">
                        {dimData.grade}
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full bg-gradient-to-r from-primary/80 to-primary transition-all duration-500"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Right: Real Report AI Feedback & Coaching Breakdown Card (6 Cols) */}
          <div className="lg:col-span-6 rounded-2xl border border-border/80 bg-card p-6 sm:p-7 shadow-xl space-y-5">
            <div className="flex items-center justify-between pb-4 border-b border-border/60">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-tr from-primary to-blue-600 text-primary-foreground shadow-xs">
                  <ActiveIcon className="size-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-foreground">
                      {locale === "zh" ? `${activeDim.name} (${activeDim.enName})` : activeDim.enName}
                    </h3>
                    <Badge variant="outline" className={`text-[10px] px-2 py-0.5 ${activeMeta.gradeColor}`}>
                      {dimData.grade}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {activeDim.desc}
                  </p>
                </div>
              </div>

              <div className="text-right">
                <div className="font-mono text-2xl font-extrabold text-primary">
                  {activeDim.score.toFixed(1)}
                </div>
                <div className="text-[10px] text-muted-foreground">{dimData.scoreLabel}</div>
              </div>
            </div>

            {/* Real Report Breakdown Section */}
            <div className="space-y-4 text-xs">
              {/* Strengths */}
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-2">
                <div className="flex items-center gap-1.5 font-semibold text-emerald-800 dark:text-emerald-300 text-xs">
                  <CheckCircle2 className="size-4" />
                  <span>{dimData.strengthsTitle}</span>
                </div>
                <ul className="space-y-1.5 text-emerald-950/90 dark:text-emerald-200/90 leading-relaxed pl-1">
                  {activeDim.strengths.map((item, idx) => (
                    <li key={idx} className="flex items-start gap-1.5">
                      <span className="size-1 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Improvements */}
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 space-y-2">
                <div className="flex items-center gap-1.5 font-semibold text-amber-800 dark:text-amber-300 text-xs">
                  <TrendingUp className="size-4" />
                  <span>{dimData.improvementsTitle}</span>
                </div>
                <ul className="space-y-1.5 text-amber-950/90 dark:text-amber-200/90 leading-relaxed pl-1">
                  {activeDim.improvements.map((item, idx) => (
                    <li key={idx} className="flex items-start gap-1.5">
                      <span className="size-1 rounded-full bg-amber-500 mt-1.5 shrink-0" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Advice */}
              <div className="rounded-xl border border-border/80 bg-muted/30 p-3.5 text-xs text-foreground/90">
                <span className="font-semibold text-primary">{dimData.expertAdviceLabel} </span>
                {activeDim.advice}
              </div>
            </div>

            {/* Bottom Coach Mode Action */}
            <div className="pt-3 border-t border-border/50 flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{dimData.coachModePrompt}</span>
              <Button size="sm" variant="outline" className="h-7 gap-1 text-xs text-primary border-primary/30">
                <GraduationCap className="size-3.5" />
                <span>{dimData.deepDiveAction}</span>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
