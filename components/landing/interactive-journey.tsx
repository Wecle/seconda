"use client";

import { useState } from "react";
import {
  UploadCloud,
  SlidersHorizontal,
  Bot,
  BarChart3,
  CheckCircle2,
  FileCheck,
  Zap,
  Sparkles,
  BrainCircuit,
  Lightbulb,
  Check,
  TrendingUp,
} from "lucide-react";
import { useTranslation } from "@/lib/i18n/context";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const stepIcons = [UploadCloud, SlidersHorizontal, Bot, BarChart3];

export function InteractiveJourney() {
  const { t } = useTranslation();
  const journey = t.landing.journey;
  const [activeStep, setActiveStep] = useState(0);

  const stepPreviews = [
    {
      title: "智能简历解析与事实图谱构建",
      tag: "Resume Ingestion & Parsing",
      content: (
        <div className="space-y-3">
          {/* Upload File Banner */}
          <div className="flex items-center justify-between rounded-lg border border-border/80 bg-background p-3">
            <div className="flex items-center gap-2.5">
              <div className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
                <FileCheck className="size-4" />
              </div>
              <div>
                <div className="text-xs font-semibold text-foreground">
                  Senior_Frontend_Architect.pdf
                </div>
                <div className="text-[10px] text-muted-foreground">1.8 MB · 解析完成</div>
              </div>
            </div>
            <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px]">
              已提取事实
            </Badge>
          </div>

          {/* Parsed Structure Preview */}
          <div className="rounded-xl border border-border/80 bg-background p-3.5 text-xs space-y-2">
            <div className="flex justify-between items-center text-[11px] pb-1.5 border-b border-border/50">
              <span className="font-semibold text-foreground">核心经历事实</span>
              <span className="font-mono text-primary font-medium">18 项技能标签</span>
            </div>
            <div className="space-y-1 text-muted-foreground text-[11px]">
              <p>• 经历：字节跳动 · 架构平台部 (2021-至今)</p>
              <p>• 亮点：重构微前端状态流，消除级联渲染，首屏交互耗时降低 40%</p>
            </div>
            <div className="flex flex-wrap gap-1.5 pt-1">
              <span className="rounded bg-muted px-2 py-0.5 text-[10px] font-medium text-foreground">React 19</span>
              <span className="rounded bg-muted px-2 py-0.5 text-[10px] font-medium text-foreground">TypeScript</span>
              <span className="rounded bg-muted px-2 py-0.5 text-[10px] font-medium text-foreground">微前端</span>
              <span className="rounded bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">性能调优</span>
            </div>
          </div>
        </div>
      ),
    },
    {
      title: "面试场域与面试官风格配置",
      tag: "Settings Dialog Replica",
      content: (
        <div className="space-y-3">
          {/* Settings Form Snapshot */}
          <div className="rounded-xl border border-border/80 bg-background p-3.5 space-y-2.5 text-xs">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-muted/40 p-2 border border-border/60">
                <span className="text-[10px] text-muted-foreground">目标岗位</span>
                <div className="font-semibold text-foreground mt-0.5">资深前端架构师</div>
              </div>
              <div className="rounded-lg bg-muted/40 p-2 border border-border/60">
                <span className="text-[10px] text-muted-foreground">目标级别</span>
                <div className="font-semibold text-foreground mt-0.5">Senior / Staff</div>
              </div>
            </div>

            {/* Persona and Focus selection */}
            <div className="space-y-1.5">
              <span className="text-[10px] text-muted-foreground">面试官风格</span>
              <div className="flex gap-1.5">
                <span className="rounded-md border border-primary/30 bg-primary/10 px-2 py-1 text-[11px] font-semibold text-primary">
                  标准型 · 专业平衡
                </span>
                <span className="rounded-md border border-border bg-muted/30 px-2 py-1 text-[11px] text-muted-foreground">
                  压力型
                </span>
              </div>
            </div>

            <div className="space-y-1.5 pt-1">
              <span className="text-[10px] text-muted-foreground">考察重点偏好</span>
              <div className="flex flex-wrap gap-1.5">
                <span className="inline-flex items-center gap-1 rounded bg-primary text-primary-foreground px-2 py-0.5 text-[10px] font-medium">
                  <Check className="size-2.5" />
                  <span>项目深挖</span>
                </span>
                <span className="rounded border border-border bg-muted/20 px-2 py-0.5 text-[10px] text-muted-foreground">
                  高并发架构
                </span>
              </div>
            </div>
          </div>
        </div>
      ),
    },
    {
      title: "自适应 Agent 连续对练与追问",
      tag: "Live Room Stream",
      content: (
        <div className="space-y-2.5">
          {/* Reasoning Row */}
          <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-card p-2 text-xs">
            <BrainCircuit className="size-3.5 text-primary" />
            <span className="font-medium text-foreground">思考链路：</span>
            <span className="truncate text-muted-foreground text-[11px]">
              锁定经历要点 → 针对微前端状态隔离与内存回收发起追问
            </span>
          </div>

          {/* Question Card */}
          <div className="rounded-xl border border-border/80 bg-background p-3 text-xs space-y-1.5">
            <div className="flex items-center gap-1.5 text-primary font-bold text-[11px]">
              <Sparkles className="size-3" />
              <span>AI 面试官 · 架构考查</span>
            </div>
            <p className="text-foreground leading-relaxed text-[11px]">
              “在微前端多子应用共存时，你如何防止全局状态泄露与事件订阅悬挂？”
            </p>
          </div>

          {/* Hint Card */}
          <div className="flex items-center gap-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 p-2 text-[11px] text-amber-900 dark:text-amber-300">
            <Lightbulb className="size-3 shrink-0" />
            <span>提示：建议阐述自定义事件总线沙箱与卸载回收钩子。</span>
          </div>
        </div>
      ),
    },
    {
      title: "六维诊断报告与教练辅导",
      tag: "Report & Deep Dive",
      content: (
        <div className="space-y-3">
          {/* Score Card Replica */}
          <div className="flex items-center justify-between rounded-xl border border-border/80 bg-background p-3.5">
            <div>
              <div className="text-[10px] uppercase font-semibold text-muted-foreground">综合表现</div>
              <div className="flex items-baseline gap-1 mt-0.5">
                <span className="font-mono text-2xl font-black text-primary">88</span>
                <span className="text-xs text-muted-foreground font-medium">/ 100</span>
              </div>
            </div>
            <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 text-xs font-semibold">
              表现优秀
            </Badge>
          </div>

          {/* Strengths / Improvements Snapshot */}
          <div className="rounded-xl border border-border/80 bg-background p-3 text-xs space-y-1.5">
            <div className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold text-[11px]">
              <CheckCircle2 className="size-3" />
              <span>核心优势：逻辑架构清晰，量化收益详实</span>
            </div>
            <div className="flex items-center gap-1 text-amber-600 dark:text-amber-400 font-semibold text-[11px]">
              <TrendingUp className="size-3" />
              <span>改进建议：可进一步拓展极端网络故障自愈</span>
            </div>
          </div>
        </div>
      ),
    },
  ];

  return (
    <section className="py-24 sm:py-32 relative">
      <div className="mx-auto max-w-6xl px-6">
        {/* Section Header */}
        <div className="mx-auto max-w-3xl text-center mb-16 sm:mb-20">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/[0.05] px-3.5 py-1 text-xs font-semibold text-primary mb-4">
            <Zap className="size-3.5" />
            <span>{journey.badge}</span>
          </div>
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl lg:text-5xl text-balance">
            {journey.title}
          </h2>
          <p className="mt-4 text-base sm:text-lg text-muted-foreground leading-relaxed text-balance">
            {journey.subtitle}
          </p>
        </div>

        {/* Interactive Step Workspace */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
          {/* Left: Step Buttons (7 Cols) */}
          <div className="lg:col-span-7 flex flex-col justify-between gap-3">
            {journey.steps.map((step, idx) => {
              const Icon = stepIcons[idx] || Bot;
              const isActive = activeStep === idx;

              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setActiveStep(idx)}
                  className={cn(
                    "group flex items-start gap-4 p-5 rounded-2xl border text-left transition-all duration-200 cursor-pointer",
                    isActive
                      ? "border-primary bg-card shadow-lg ring-1 ring-primary/40 -translate-y-0.5"
                      : "border-border/70 bg-card/60 hover:bg-card hover:border-border",
                  )}
                >
                  <div
                    className={cn(
                      "flex size-11 items-center justify-center rounded-xl font-mono text-sm font-bold transition-colors shrink-0",
                      isActive
                        ? "bg-primary text-primary-foreground shadow-xs"
                        : "bg-muted text-muted-foreground group-hover:text-foreground",
                    )}
                  >
                    <Icon className="size-5" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-primary">
                          STEP {step.step}
                        </span>
                        <h3 className="font-bold text-base text-foreground">
                          {step.title}
                        </h3>
                      </div>
                      <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                        {step.badge}
                      </span>
                    </div>
                    <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                      {step.desc}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Right: Step Live Preview Card (5 Cols) */}
          <div className="lg:col-span-5 flex flex-col justify-between rounded-2xl border border-border/80 bg-card p-6 sm:p-8 shadow-xl">
            <div>
              <div className="flex items-center justify-between pb-3 border-b border-border/60 mb-5">
                <span className="font-mono text-xs font-bold text-primary">
                  STAGE {activeStep + 1} · REAL UI PREVIEW
                </span>
                <span className="rounded-md border border-border bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground font-medium">
                  {stepPreviews[activeStep].tag}
                </span>
              </div>
              <h4 className="text-base font-bold text-foreground mb-4">
                {stepPreviews[activeStep].title}
              </h4>
              {stepPreviews[activeStep].content}
            </div>

            <div className="mt-6 pt-4 border-t border-border/50 flex items-center justify-between text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-medium">
                <CheckCircle2 className="size-3.5" />
                <span>全链路真实交互对齐</span>
              </span>
              <span className="font-mono font-semibold text-foreground">
                Step {activeStep + 1} of 4
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
