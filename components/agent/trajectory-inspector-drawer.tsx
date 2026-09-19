"use client";

import { useState } from "react";
import {
  Check,
  Clock,
  Copy,
  Cpu,
  Layers,
  Sparkles,
  Terminal,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/ui/markdown";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type {
  TrajectoryItem,
  TrajectoryItemRole,
  TrajectoryStep,
  TrajectoryToolCall,
  TrajectoryTurn,
} from "@/lib/agent/types";

export interface TrajectoryInspectorDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item?: TrajectoryItem | null;
  turn?: TrajectoryTurn | null;
  step?: TrajectoryStep | null;
  toolCall?: TrajectoryToolCall | null;
}

function roleBadgeStyle(role: TrajectoryItemRole) {
  switch (role) {
    case "system":
      return "bg-slate-500/10 text-slate-700 border-slate-500/25 dark:bg-slate-500/20 dark:text-slate-200 dark:border-slate-500/35";
    case "context":
      return "bg-emerald-500/10 text-emerald-700 border-emerald-500/25 dark:bg-emerald-500/20 dark:text-emerald-300 dark:border-emerald-500/35";
    case "user":
      return "bg-sky-500/10 text-sky-700 border-sky-500/25 dark:bg-sky-500/20 dark:text-sky-300 dark:border-sky-500/35";
    case "assistant":
      return "bg-violet-500/10 text-violet-700 border-violet-500/25 dark:bg-violet-500/20 dark:text-violet-300 dark:border-violet-500/35";
    case "tool":
      return "bg-amber-500/10 text-amber-700 border-amber-500/25 dark:bg-amber-500/20 dark:text-amber-300 dark:border-amber-500/35";
    case "outcome":
      return "bg-teal-500/10 text-teal-700 border-teal-500/25 dark:bg-teal-500/20 dark:text-teal-300 dark:border-teal-500/35";
  }
}

function MetricCard({
  label,
  value,
  icon: Icon,
  unit,
}: {
  label: string;
  value?: string | number | null;
  icon: React.ElementType;
  unit?: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card p-3 shadow-2xs">
      <div className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-muted-foreground">{label}</p>
        <p className="text-sm font-semibold tracking-tight text-foreground truncate">
          {value !== undefined && value !== null ? (
            <>
              {value} {unit ? <span className="text-[10px] font-normal text-muted-foreground">{unit}</span> : null}
            </>
          ) : (
            <span className="text-muted-foreground font-normal text-xs">—</span>
          )}
        </p>
      </div>
    </div>
  );
}

export function TrajectoryInspectorDrawer({
  open,
  onOpenChange,
  item,
  turn,
}: TrajectoryInspectorDrawerProps) {
  const [copied, setCopied] = useState(false);

  if (!item) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-full sm:max-w-lg md:max-w-xl flex flex-col p-6">
          <SheetHeader>
            <SheetTitle>轨迹检视</SheetTitle>
            <SheetDescription>请在左侧轨迹列表中选择任意消息或步骤以查看明细。</SheetDescription>
          </SheetHeader>
        </SheetContent>
      </Sheet>
    );
  }

  const role = item.role;
  const turnIndex = turn?.turnIndex ?? 1;
  const rawText = typeof item.raw === "string" ? item.raw : JSON.stringify(item.raw ?? item.content, null, 2);

  const handleCopyRaw = () => {
    void navigator.clipboard.writeText(rawText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg md:max-w-2xl flex flex-col p-0 gap-0">
        {/* Drawer Header matching DSH */}
        <SheetHeader className="border-b p-5 shrink-0 bg-muted/20">
          <div className="flex items-center gap-2.5">
            <span
              className={cn(
                "px-2.5 py-0.5 rounded font-mono text-[11px] font-bold tracking-wider shrink-0 border uppercase",
                roleBadgeStyle(role)
              )}
            >
              {role}
            </span>
            <div className="min-w-0 flex-1">
              <SheetTitle className="text-sm truncate">
                Turn {turnIndex} · {item.title}
              </SheetTitle>
              <SheetDescription className="font-mono text-xs truncate">
                Seq #{item.sequence} · {item.source ?? "System"}
              </SheetDescription>
            </div>
            {item.durationMs !== undefined && item.durationMs > 0 ? (
              <Badge variant="secondary" className="gap-1 font-mono text-xs">
                <Clock className="size-3" />
                {item.durationMs} ms
              </Badge>
            ) : null}
          </div>
        </SheetHeader>

        {/* 4 Tabs: Summary | Preview | Raw | Source */}
        <ScrollArea className="flex-1 min-h-0">
          <div className="p-5">
            <Tabs defaultValue="summary" className="w-full space-y-4">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="summary" className="text-xs">
                  Summary
                </TabsTrigger>
                <TabsTrigger value="preview" className="text-xs">
                  Preview
                </TabsTrigger>
                <TabsTrigger value="raw" className="text-xs">
                  Raw
                </TabsTrigger>
                <TabsTrigger value="source" className="text-xs">
                  Source
                </TabsTrigger>
              </TabsList>

              {/* Tab 1: Summary */}
              <TabsContent value="summary" className="space-y-4">
                {/* Meta details table */}
                <div className="rounded-lg border bg-muted/20 p-3 text-xs space-y-2 font-mono">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Source</span>
                    <span className="font-semibold text-foreground">{item.source ?? "Runtime"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Status</span>
                    <span className="font-semibold capitalize text-foreground">{item.status ?? "Completed"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Duration</span>
                    <span className="font-semibold text-foreground">{item.durationMs ?? 0} ms</span>
                  </div>
                  {item.metrics?.finishReason ? (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Finish Reason</span>
                      <span className="font-semibold text-foreground">{item.metrics.finishReason}</span>
                    </div>
                  ) : null}
                </div>

                {/* Metrics Grid if available */}
                {item.metrics ? (
                  <div className="grid grid-cols-2 gap-2.5">
                    {item.metrics.firstTokenMs !== undefined ? (
                      <MetricCard
                        label="首字延迟 (TTFT)"
                        value={item.metrics.firstTokenMs}
                        icon={Clock}
                        unit="ms"
                      />
                    ) : null}
                    <MetricCard
                      label="步骤耗时"
                      value={item.durationMs}
                      icon={Clock}
                      unit="ms"
                    />
                    <MetricCard
                      label="输入 Token"
                      value={item.metrics.inputTokens?.toLocaleString()}
                      icon={Cpu}
                    />
                    <MetricCard
                      label="输出 Token"
                      value={item.metrics.outputTokens?.toLocaleString()}
                      icon={Cpu}
                    />
                    {item.metrics.reasoningTokens ? (
                      <MetricCard
                        label="思考 Token"
                        value={item.metrics.reasoningTokens?.toLocaleString()}
                        icon={Sparkles}
                      />
                    ) : null}
                    {item.metrics.cachedInputTokens ? (
                      <MetricCard
                        label="缓存命中 Token"
                        value={item.metrics.cachedInputTokens?.toLocaleString()}
                        icon={Layers}
                      />
                    ) : null}
                    <MetricCard
                      label="总 Token"
                      value={item.metrics.totalTokens?.toLocaleString()}
                      icon={Zap}
                    />
                  </div>
                ) : null}

                {/* Preview snippet */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-muted-foreground font-medium">
                    <span>Preview</span>
                  </div>
                  <div className="rounded-lg border bg-card p-3 text-xs leading-relaxed text-foreground whitespace-pre-wrap break-words max-h-60 overflow-y-auto">
                    {item.content || item.preview || "(空)"}
                  </div>
                </div>
              </TabsContent>

              {/* Tab 2: Preview (Markdown/Formatted) */}
              <TabsContent value="preview" className="space-y-3">
                {item.reasoning?.content ? (
                  <div className="space-y-1.5 mb-4">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
                      <Sparkles className="size-3.5 text-primary" />
                      <span>思考链路 (Reasoning Trace)</span>
                    </div>
                    <pre className="rounded-lg border bg-muted/30 p-3.5 font-mono text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap break-words max-h-60 overflow-y-auto">
                      {item.reasoning.content}
                    </pre>
                  </div>
                ) : null}

                <div className="rounded-lg border bg-card p-4 text-xs leading-relaxed text-foreground min-h-[140px] max-h-[520px] overflow-y-auto">
                  {item.role === "tool" ? (
                    <pre className="font-mono text-[11px] whitespace-pre-wrap break-all leading-relaxed">
                      {item.content}
                    </pre>
                  ) : (
                    <div className="space-y-3">
                      <Markdown content={item.content || item.preview || "(空)"} />
                    </div>
                  )}
                </div>
              </TabsContent>

              {/* Tab 3: Raw (JSON/Text with Copy) */}
              <TabsContent value="raw" className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground font-mono">Payload JSON</span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1.5 px-2.5 text-xs"
                    onClick={handleCopyRaw}
                  >
                    {copied ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
                    {copied ? "已复制" : "复制"}
                  </Button>
                </div>
                <pre className="rounded-lg border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all max-h-96 overflow-y-auto select-all">
                  {rawText || "(空)"}
                </pre>
              </TabsContent>

              {/* Tab 4: Source (Provenance) */}
              <TabsContent value="source" className="space-y-3 font-mono text-xs">
                <div className="rounded-lg border bg-card p-4 space-y-2.5">
                  <div className="flex items-center gap-2 text-foreground font-semibold">
                    <Terminal className="size-4 text-primary" />
                    <span>Event Provenance</span>
                  </div>
                  <div className="space-y-1.5 text-muted-foreground pt-1 border-t border-border/40">
                    <div>Sequence Number: <span className="text-foreground">#{item.sequence}</span></div>
                    <div>Role: <span className="text-foreground">{item.role}</span></div>
                    <div>Source: <span className="text-foreground">{item.source ?? "System"}</span></div>
                    <div>Timestamp: <span className="text-foreground">{new Date(item.timestamp).toISOString()}</span></div>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
