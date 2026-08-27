"use client";

import { useState } from "react";
import {
  Sparkles,
  UserRound,
  BrainCircuit,
  Puzzle,
  CheckCircle2,
  ChevronDown,
  Lightbulb,
  Send,
  Square,
  ArrowLeft,
} from "lucide-react";
import { BrandIcon } from "@/components/brand/brand-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function HeroMockup() {
  const [reasoningExpanded, setReasoningExpanded] = useState(false);
  const [tipExpanded, setTipExpanded] = useState(true);
  const [currentAnswer, setCurrentAnswer] = useState(
    "我们针对核心状态树实施了读写分离与原子化拆分。将全局会话与高频表单解耦，引入选择性订阅器将组件渲染控制在单节点。在跨微应用场景下，通过 CustomEvent 契约配合状态快照避免数据污染...",
  );

  return (
    <div className="relative mx-auto w-full max-w-5xl">
      {/* Outer ambient glow */}
      <div
        className="pointer-events-none absolute -inset-1 rounded-3xl bg-gradient-to-r from-primary/30 via-primary/10 to-blue-500/20 blur-xl opacity-70 transition-all duration-500"
        aria-hidden="true"
      />

      {/* Main Browser Window Mockup */}
      <div className="relative overflow-hidden rounded-2xl border border-border/80 bg-background shadow-2xl">
        {/* Real Interview Room Header */}
        <header className="sticky top-0 z-20 shrink-0 border-b border-border/80 bg-background/95 backdrop-blur-md">
          <div className="mx-auto flex h-14 items-center justify-between gap-4 px-4 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex shrink-0 items-center gap-2 font-semibold tracking-tight">
                <BrandIcon size={26} priority />
                <span className="hidden font-bold tracking-tight sm:inline text-sm">
                  Seconda
                </span>
              </div>

              <div className="h-4 w-px bg-border/80" aria-hidden="true" />

              <div className="min-w-0">
                <h2 className="truncate text-xs sm:text-sm font-semibold tracking-tight">
                  Senior_Frontend_Architect.pdf
                </h2>
                <p className="truncate text-[11px] text-muted-foreground">
                  第 2 题 / 共 5 题
                </p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2 sm:gap-2.5">
              <Badge
                variant="secondary"
                className="rounded-md border border-primary/20 bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary"
              >
                等待回答
              </Badge>

              <Button
                variant="ghost"
                size="sm"
                className="hidden h-7 gap-1 text-xs text-muted-foreground hover:bg-muted/80 hover:text-foreground sm:inline-flex"
              >
                <Square className="size-3" />
                <span>提前结束</span>
              </Button>

              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="size-3.5" />
              </Button>

              <div className="flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground font-semibold text-xs shadow-xs">
                W
              </div>
            </div>
          </div>

          {/* Smooth Progress Bar */}
          <div
            className="relative h-1 w-full bg-muted/60 overflow-hidden"
            role="progressbar"
            aria-valuenow={40}
          >
            <div
              className="h-full bg-gradient-to-r from-primary/80 to-primary transition-all duration-500 ease-out"
              style={{ width: "40%" }}
            />
          </div>
        </header>

        {/* Main Conversation Stream */}
        <div className="p-4 sm:p-6 md:p-8 space-y-6 max-w-3xl mx-auto">
          {/* 1. Skill Loaded Badge Row */}
          <div className="flex items-center gap-2 pl-11 text-xs">
            <div className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-muted/30 px-2.5 py-1 text-muted-foreground">
              <Puzzle className="size-3.5 text-primary/70" />
              <span className="font-mono text-[11px]">Skill · 项目深挖 已加载</span>
              <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                <CheckCircle2 className="size-3" />
              </span>
            </div>
          </div>

          {/* 2. Reasoning Row (Seconda Signature Feature) */}
          <article className="flex items-start gap-3.5">
            <div className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-muted-foreground/20 to-muted-foreground/10 text-foreground ring-1 ring-border/80">
              <BrainCircuit className="size-4 text-primary" />
            </div>

            <div className="min-w-0 max-w-[90%] flex-1">
              <div className="overflow-hidden rounded-xl border border-border/70 bg-card/60 shadow-2xs transition-all hover:border-border">
                <button
                  type="button"
                  onClick={() => setReasoningExpanded(!reasoningExpanded)}
                  className="flex w-full cursor-pointer items-center justify-between gap-2.5 px-3.5 py-2 text-left text-xs transition-colors hover:bg-muted/40"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden text-muted-foreground">
                    <span className="size-2 shrink-0 rounded-full bg-primary opacity-80" />
                    <span className="shrink-0 font-medium text-foreground/80">
                      思考链路
                    </span>
                    <span aria-hidden="true" className="size-0.5 shrink-0 rounded-full bg-muted-foreground/50" />
                    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground/80">
                      分析简历事实：“主导重构核心交易链路前端架构，降低 40% 渲染耗时” → 针对微前端与状态隔离生成权衡考题
                    </span>
                  </div>
                  <ChevronDown
                    className={`size-3.5 shrink-0 text-muted-foreground/70 transition-transform duration-300 ${
                      reasoningExpanded ? "rotate-180" : ""
                    }`}
                  />
                </button>

                {reasoningExpanded && (
                  <div className="border-t border-border/50 bg-muted/20 px-3.5 py-2.5">
                    <div className="max-h-48 overflow-y-auto border-l-2 border-primary/40 pl-3 pr-1 font-mono text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap">
                      {`[1] 检索候选人简历快照：发现技术栈关键词 React, State Management, Performance
[2] 锁定经历要点：在微前端环境下实施状态重构，指标宣称为减少 40% 耗时
[3] 考点规划：考察原子化状态拆分、选择性订阅以及跨子应用通信的垃圾回收与隔离策略
[4] 生成第二轮主问题并附带思考提示`}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </article>

          {/* 3. AI Interviewer Question Card */}
          <article className="flex items-start gap-3.5">
            <div className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl bg-gradient-to-tr from-primary to-blue-600 text-primary-foreground shadow-xs ring-2 ring-primary/20">
              <Sparkles className="size-4" />
            </div>

            <div className="min-w-0 max-w-[88%] space-y-3 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-semibold text-foreground">AI 面试官</span>
                <span className="text-muted-foreground/50">·</span>
                <Badge
                  variant="secondary"
                  className="rounded-md border border-primary/20 bg-primary/5 px-2 py-0.5 text-[11px] font-medium text-primary"
                >
                  微前端架构 · 状态隔离
                </Badge>
              </div>

              <div className="rounded-2xl rounded-tl-xs border border-border/80 bg-card p-4 sm:p-5 shadow-xs transition-all">
                <p className="whitespace-pre-wrap break-words text-[14px] sm:text-[15px] leading-7 text-foreground/95">
                  在你的简历中提到曾重构核心交易链路前端架构并降低 40% 渲染耗时。请结合实际业务，谈谈在复杂微前端嵌套组件树下，你如何设计状态边界以避免级联重渲染与跨应用状态污染？
                </p>

                {/* Question Tip Card */}
                <div className="mt-3.5 pt-3 border-t border-border/60">
                  <button
                    type="button"
                    onClick={() => setTipExpanded(!tipExpanded)}
                    className="flex w-full cursor-pointer items-center justify-between gap-2 text-xs font-medium text-amber-700 dark:text-amber-400 hover:opacity-80 transition-opacity"
                  >
                    <span className="flex items-center gap-1.5">
                      <Lightbulb className="size-3.5" />
                      提示
                    </span>
                    <ChevronDown
                      className={`size-3.5 transition-transform duration-300 ${
                        tipExpanded ? "rotate-180" : ""
                      }`}
                    />
                  </button>

                  {tipExpanded && (
                    <div className="mt-2 rounded-lg bg-amber-500/8 border border-amber-500/20 p-3 text-xs leading-relaxed text-amber-950 dark:text-amber-200">
                      建议重点阐述原子化状态管理方案、选择性订阅机制，以及子应用卸载时的事件监听注销与内存回收策略。
                    </div>
                  )}
                </div>
              </div>
            </div>
          </article>

          {/* 4. Candidate Answer Bubble */}
          <article className="flex items-start justify-end gap-3.5">
            <div className="min-w-0 max-w-[85%] space-y-1">
              <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
                <span className="font-medium">你 (候选人)</span>
              </div>
              <div className="rounded-2xl rounded-tr-xs bg-primary text-primary-foreground px-4.5 py-3 shadow-xs text-xs sm:text-sm leading-relaxed">
                <p className="whitespace-pre-wrap break-words">
                  针对这个问题，我们采用了“读写分离 + 原子化订阅”原则。将全局共享的用户会话与高频变动的表单和行内状态解耦，引入 Selector 细粒度订阅器将组件层级的重渲染控制在单节点。对于跨微应用的状态同步，通过严格的 CustomEvent 契约配合不可变快照隔离，并在应用卸载时自动清理监听...
                </p>
              </div>
            </div>

            <div className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl border border-border/80 bg-card text-foreground shadow-2xs">
              <UserRound className="size-4 text-muted-foreground" />
            </div>
          </article>
        </div>

        {/* Real Bottom Composer Dock */}
        <footer className="sticky bottom-0 z-20 shrink-0 border-t border-border/80 bg-background/85 p-3 backdrop-blur-md md:p-4">
          <div className="mx-auto max-w-3xl">
            <div className="overflow-hidden rounded-2xl border border-border/80 bg-card/90 shadow-lg ring-1 ring-black/5 dark:ring-white/5 transition-all focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/20">
              <Textarea
                value={currentAnswer}
                onChange={(e) => setCurrentAnswer(e.target.value)}
                placeholder="在此输入你的回答..."
                className="max-h-36 min-h-16 resize-none border-0 bg-transparent px-3.5 py-2.5 text-xs sm:text-sm shadow-none focus-visible:ring-0 placeholder:text-muted-foreground/60"
              />

              <div className="flex items-center justify-between border-t border-border/40 bg-muted/20 px-3 py-2 text-xs">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <span className="font-mono text-[11px]">{currentAnswer.length} 字</span>
                  <span className="hidden sm:inline text-muted-foreground/60">· ⌘/Ctrl + Enter 提交</span>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-muted-foreground hover:text-foreground"
                  >
                    跳过此题
                  </Button>
                  <Button
                    size="sm"
                    className="h-7 gap-1.5 px-3 text-xs font-medium shadow-xs"
                  >
                    <Send className="size-3" />
                    <span>提交回答</span>
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
