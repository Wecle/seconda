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

const DIMENSION_CONFIG = {
  understanding: {
    labelZh: "理解力",
    labelEn: "Understanding",
    description: "准确把握问题核心与业务/技术底层意图",
    icon: Compass,
    score: 9.2,
    grade: "表现优秀",
    gradeColor: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
    sampleFeedback: {
      strengths: ["精准识别出并发状态竞争与微前端生命周期不一致的隐性痛点", "主动确认了 100K QPS 的容量边界条件"],
      improvements: ["可进一步补充极端网络抖动下的超时重试容错处理"],
      advice: "回答紧扣架构核心，建议在系统异常边界处做进一步推演。",
    },
  },
  expression: {
    labelZh: "表达力",
    labelEn: "Expression",
    description: "结构严谨、术语规范、要点清晰突出",
    icon: MessageSquare,
    score: 8.8,
    grade: "表现优秀",
    gradeColor: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
    sampleFeedback: {
      strengths: ["采用三段式递进阐述，术语专业标准", "核心设计原则（读写分离、原子订阅）交代清晰"],
      improvements: ["对复杂状态同步流的口头描述稍显紧凑，可适当增加过渡总结"],
      advice: "语言精炼度极高，若能配合框架对比说明将更具说服力。",
    },
  },
  logic: {
    labelZh: "逻辑性",
    labelEn: "Logic",
    description: "因果推导严密、架构拆分具备自洽性",
    icon: Network,
    score: 9.0,
    grade: "表现优秀",
    gradeColor: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
    sampleFeedback: {
      strengths: ["遵循 STAR 严密推导：现状瓶颈 -> 方案选型 -> 落地指标 -> 边界防御", "因果链条闭环"],
      improvements: ["可在方案对比阶段多列举 1 种被否决的技术路径"],
      advice: "论述结构极佳，逻辑自洽，展现出优秀的系统化思维。",
    },
  },
  depth: {
    labelZh: "深度",
    labelEn: "Depth",
    description: "触及底层原理、权衡考量与边界治理",
    icon: Cpu,
    score: 8.5,
    grade: "表现优秀",
    gradeColor: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
    sampleFeedback: {
      strengths: ["深入剖析了 React 19 Fiber 调度与选择性订阅器的底层订阅机制", "涉及微应用沙箱内存回收细节"],
      improvements: ["可补充对 V8 垃圾回收在长生命周期子应用中的影响剖析"],
      advice: "技术底层功底扎实，对复杂系统运行机理理解深刻。",
    },
  },
  authenticity: {
    labelZh: "真实性",
    labelEn: "Authenticity",
    description: "结合真实复杂场景、量化数据与工程权衡",
    icon: Layers,
    score: 9.5,
    grade: "表现优秀",
    gradeColor: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
    sampleFeedback: {
      strengths: ["给出真实的重构收益数据（40% 渲染耗时降低）与监控指标变化", "讲述了具体的踩坑排障经过"],
      improvements: ["可补充重构过程中的灰度发布与线上回滚预案细节"],
      advice: "经验真实丰富，细节详实，具备高年级工程师的实战说服力。",
    },
  },
  reflection: {
    labelZh: "反思力",
    labelEn: "Reflection",
    description: "展现自省复盘、故障定界与持续迭代认知",
    icon: History,
    score: 8.7,
    grade: "表现优秀",
    gradeColor: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
    sampleFeedback: {
      strengths: ["客观指出了原子化状态拆分带来的微小开发心智成本，并给出了团队规范约束方案"],
      improvements: ["对未来跨端/服务端同构渲染演进方向可作进一步前瞻规划"],
      advice: "具备优秀的工程自省与技术债管理意识。",
    },
  },
};

export function DimensionMatrix() {
  const { t } = useTranslation();
  const dimData = t.landing.dimensions;
  const [selectedKey, setSelectedKey] = useState<keyof typeof DIMENSION_CONFIG>("understanding");

  const activeDim = DIMENSION_CONFIG[selectedKey];
  const ActiveIcon = activeDim.icon;

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
            {(Object.keys(DIMENSION_CONFIG) as Array<keyof typeof DIMENSION_CONFIG>).map((key) => {
              const item = DIMENSION_CONFIG[key];
              const Icon = item.icon;
              const isSelected = selectedKey === key;
              const percent = Math.round(item.score * 10);

              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelectedKey(key)}
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
                          {item.labelZh}
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
                      {item.description}
                    </p>
                  </div>

                  <div className="mt-3.5 pt-2 border-t border-border/40">
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
                      <span>能力评级</span>
                      <span className="font-medium text-emerald-600 dark:text-emerald-400">
                        {item.grade}
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
                      {activeDim.labelZh} ({activeDim.labelEn})
                    </h3>
                    <Badge variant="outline" className={`text-[10px] px-2 py-0.5 ${activeDim.gradeColor}`}>
                      {activeDim.grade}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {activeDim.description}
                  </p>
                </div>
              </div>

              <div className="text-right">
                <div className="font-mono text-2xl font-extrabold text-primary">
                  {activeDim.score.toFixed(1)}
                </div>
                <div className="text-[10px] text-muted-foreground">得分 (满分 10.0)</div>
              </div>
            </div>

            {/* Real Report Breakdown Section */}
            <div className="space-y-4 text-xs">
              {/* Strengths */}
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-2">
                <div className="flex items-center gap-1.5 font-semibold text-emerald-800 dark:text-emerald-300 text-xs">
                  <CheckCircle2 className="size-4" />
                  <span>核心优势 (Strengths)</span>
                </div>
                <ul className="space-y-1.5 text-emerald-950/90 dark:text-emerald-200/90 leading-relaxed pl-1">
                  {activeDim.sampleFeedback.strengths.map((item, idx) => (
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
                  <span>改进建议 (Improvements)</span>
                </div>
                <ul className="space-y-1.5 text-amber-950/90 dark:text-amber-200/90 leading-relaxed pl-1">
                  {activeDim.sampleFeedback.improvements.map((item, idx) => (
                    <li key={idx} className="flex items-start gap-1.5">
                      <span className="size-1 rounded-full bg-amber-500 mt-1.5 shrink-0" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Advice */}
              <div className="rounded-xl border border-border/80 bg-muted/30 p-3.5 text-xs text-foreground/90">
                <span className="font-semibold text-primary">💡 专家点评：</span>
                {activeDim.sampleFeedback.advice}
              </div>
            </div>

            {/* Bottom Coach Mode Action */}
            <div className="pt-3 border-t border-border/50 flex items-center justify-between text-xs">
              <span className="text-muted-foreground">支持一键进入教练模式复盘</span>
              <Button size="sm" variant="outline" className="h-7 gap-1 text-xs text-primary border-primary/30">
                <GraduationCap className="size-3.5" />
                <span>深入分析此题</span>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
