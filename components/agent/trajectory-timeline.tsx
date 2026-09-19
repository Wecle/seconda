"use client";

import { useMemo } from "react";
import {
  Clock,
  Layers,
  Search,
  Wrench,
  X,
} from "lucide-react";
import type { TrajectoryItem, TrajectoryTurn } from "@/lib/agent/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type TimelineLane = "all" | "input" | "model" | "tools";

export interface TrajectoryTimelineProps {
  turns: readonly TrajectoryTurn[];
  selectedItemId?: string | null;
  onSelectItem?: (item: TrajectoryItem, turn: TrajectoryTurn) => void;
  durationMode: "sequence" | "duration";
  onToggleDurationMode: () => void;
  allTurnsCollapsed: boolean;
  onToggleAllTurns: () => void;
  callsOnly: boolean;
  onToggleCallsOnly: () => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  activeLaneFilter: TimelineLane;
  onLaneFilterChange: (lane: TimelineLane) => void;
}

function getLaneForItem(item: TrajectoryItem): 0 | 1 | 2 {
  if (item.role === "tool") return 2; // Tools
  if (item.role === "assistant" || item.role === "outcome") return 1; // Model
  return 0; // Input (system, context, user)
}

function getItemColorClass(item: TrajectoryItem): string {
  if (item.status === "failed") return "bg-rose-500 dark:bg-rose-400";
  switch (item.role) {
    case "system":
      return "bg-slate-300 dark:bg-slate-300";
    case "context":
      return "bg-emerald-400 dark:bg-emerald-400";
    case "user":
      return "bg-sky-400 dark:bg-sky-400";
    case "assistant":
      return "bg-violet-400 dark:bg-violet-400";
    case "outcome":
      return "bg-teal-400 dark:bg-teal-400";
    case "tool":
      return "bg-amber-400 dark:bg-amber-400";
    default:
      return "bg-muted-foreground";
  }
}

export function TrajectoryTimeline({
  turns,
  selectedItemId,
  onSelectItem,
  durationMode,
  onToggleDurationMode,
  allTurnsCollapsed,
  onToggleAllTurns,
  callsOnly,
  onToggleCallsOnly,
  searchQuery,
  onSearchChange,
  activeLaneFilter,
  onLaneFilterChange,
}: TrajectoryTimelineProps) {
  // Flatten turns into chronological columns
  const turnLayouts = useMemo(() => {
    return turns.map((turn) => {
      const items = turn.items;
      const turnDuration = Math.max(turn.totalMetrics.durationMs || 200, 100);

      const laidItems = items.map((item) => {
        const lane = getLaneForItem(item);
        const itemDuration = Math.max(item.durationMs || 60, 40);
        return {
          item,
          lane,
          duration: itemDuration,
          weight: durationMode === "duration" ? itemDuration : 1,
        };
      });

      const totalWeight = laidItems.reduce((acc, curr) => acc + curr.weight, 0) || 1;

      return {
        turn,
        items: laidItems,
        totalWeight,
        turnDuration,
      };
    });
  }, [turns, durationMode]);

  return (
    <div className="rounded-xl border bg-card/90 shadow-2xs overflow-hidden select-none">
      {/* Top Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-muted/20 px-3 py-1.5 text-xs">
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Duration Toggle */}
          <Button
            type="button"
            variant={durationMode === "duration" ? "secondary" : "ghost"}
            size="sm"
            onClick={onToggleDurationMode}
            className={cn(
              "h-6 gap-1.5 px-2 font-mono text-[11px] transition-all",
              durationMode === "duration"
                ? "bg-primary/10 text-primary border border-primary/20 font-semibold"
                : "text-muted-foreground hover:text-foreground"
            )}
            title={durationMode === "duration" ? "当前：按实际耗时比例展示" : "当前：按调用顺序等宽展示"}
          >
            <Clock className="size-3" />
            <span>Duration</span>
            {durationMode === "duration" ? (
              <span className="size-1.5 rounded-full bg-primary" />
            ) : null}
          </Button>

          {/* Turns Toggle */}
          <Button
            type="button"
            variant={allTurnsCollapsed ? "secondary" : "ghost"}
            size="sm"
            onClick={onToggleAllTurns}
            className={cn(
              "h-6 gap-1.5 px-2 font-mono text-[11px] transition-all",
              allTurnsCollapsed
                ? "bg-muted text-foreground border border-border font-semibold"
                : "text-muted-foreground hover:text-foreground"
            )}
            title="全部折叠 / 展开所有轮次"
          >
            <Layers className="size-3" />
            <span>Turns</span>
            <Badge variant="outline" className="h-4 px-1 text-[9px] font-mono">
              {turns.length}
            </Badge>
          </Button>

          {/* Calls Toggle */}
          <Button
            type="button"
            variant={callsOnly ? "secondary" : "ghost"}
            size="sm"
            onClick={onToggleCallsOnly}
            className={cn(
              "h-6 gap-1.5 px-2 font-mono text-[11px] transition-all",
              callsOnly
                ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 font-semibold"
                : "text-muted-foreground hover:text-foreground"
            )}
            title="筛选：仅显示工具调用与模型回复"
          >
            <Wrench className="size-3" />
            <span>Calls</span>
            {callsOnly ? (
              <span className="size-1.5 rounded-full bg-amber-500" />
            ) : null}
          </Button>

          {/* Active Lane Filter Badge if set */}
          {activeLaneFilter !== "all" ? (
            <Badge
              variant="outline"
              onClick={() => onLaneFilterChange("all")}
              className="h-5 gap-1 px-1.5 text-[10px] font-medium bg-primary/5 text-primary border-primary/30 cursor-pointer hover:bg-primary/10"
            >
              <span>泳道: {activeLaneFilter.toUpperCase()}</span>
              <X className="size-2.5" />
            </Badge>
          ) : null}
        </div>

        {/* Real-time Search Box */}
        <div className="relative w-40 sm:w-48">
          <Search className="absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="搜索..."
            className="h-6 pl-7 pr-6 text-xs bg-background/80 shadow-2xs border-border/80 focus-visible:ring-1"
          />
          {searchQuery ? (
            <button
              type="button"
              onClick={() => onSearchChange("")}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          ) : null}
        </div>
      </div>

      {/* 3-Lane Chronological Timeline Area */}
      <div className="relative flex w-full items-center overflow-x-auto overflow-y-hidden scrollbar-none px-3 py-2.5 bg-muted/10 dark:bg-background/40">
        {/* Fixed Left Column: Lane Labels */}
        <div className="sticky left-0 z-20 flex w-14 shrink-0 flex-col gap-1.5 font-mono text-[10px] text-muted-foreground/70 bg-card/90 dark:bg-card/95 backdrop-blur-xs select-none pr-2">
          <button
            type="button"
            onClick={() => onLaneFilterChange(activeLaneFilter === "input" ? "all" : "input")}
            className={cn(
              "h-4 pr-1 text-right leading-none transition-colors hover:text-foreground cursor-pointer flex items-center justify-end",
              activeLaneFilter === "input" && "text-primary font-bold"
            )}
          >
            Input
          </button>
          <button
            type="button"
            onClick={() => onLaneFilterChange(activeLaneFilter === "model" ? "all" : "model")}
            className={cn(
              "h-4 pr-1 text-right leading-none transition-colors hover:text-foreground cursor-pointer flex items-center justify-end",
              activeLaneFilter === "model" && "text-primary font-bold"
            )}
          >
            Model
          </button>
          <button
            type="button"
            onClick={() => onLaneFilterChange(activeLaneFilter === "tools" ? "all" : "tools")}
            className={cn(
              "h-4 pr-1 text-right leading-none transition-colors hover:text-foreground cursor-pointer flex items-center justify-end",
              activeLaneFilter === "tools" && "text-primary font-bold"
            )}
          >
            Tools
          </button>
        </div>

        {/* Right Gantt Tracks Area */}
        <div className="flex flex-1 min-w-0">
          {turnLayouts.map(({ turn, items, totalWeight }) => {
            return (
              <div
                key={`timeline-turn-${turn.turnIndex}`}
                style={{ flex: totalWeight }}
                className={cn(
                  "relative flex min-w-[72px] border-r border-border/40 last:border-r-0 px-[1px]",
                  turn.status === "failed" && "bg-destructive/5"
                )}
              >
                {/* 3-Lane Grid for this turn */}
                <div className="flex w-full flex-col gap-1.5">
                  {/* Lane 0: Input */}
                  <div className="relative flex h-4 w-full items-center">
                    {items.map(({ item, lane, weight }) => {
                      if (lane !== 0) {
                        return <div key={`empty-0-${item.id}`} style={{ flex: weight }} className="h-full" />;
                      }
                      const isSelected = selectedItemId === item.id;
                      return (
                        <div
                          key={`slot-0-${item.id}`}
                          style={{ flex: weight }}
                          className="h-full flex px-[0.5px]"
                        >
                          <div
                            onClick={() => onSelectItem?.(item, turn)}
                            className={cn(
                              "h-full w-full rounded-[2px] cursor-pointer transition-all hover:brightness-110",
                              getItemColorClass(item),
                              isSelected && "ring-2 ring-sky-400 dark:ring-sky-300 ring-offset-1 ring-offset-background z-10 scale-y-110"
                            )}
                          />
                        </div>
                      );
                    })}
                  </div>

                  {/* Lane 1: Model */}
                  <div className="relative flex h-4 w-full items-center">
                    {items.map(({ item, lane, weight }) => {
                      if (lane !== 1) {
                        return <div key={`empty-1-${item.id}`} style={{ flex: weight }} className="h-full" />;
                      }
                      const isSelected = selectedItemId === item.id;
                      const hasReasoning = Boolean(item.reasoning?.content || item.metrics?.reasoningTokens);

                      return (
                        <div
                          key={`slot-1-${item.id}`}
                          style={{ flex: weight }}
                          className="h-full flex px-[0.5px]"
                        >
                          <div
                            onClick={() => onSelectItem?.(item, turn)}
                            className={cn(
                              "h-full w-full rounded-[2px] cursor-pointer transition-all hover:brightness-110 overflow-hidden flex",
                              getItemColorClass(item),
                              isSelected && "ring-2 ring-sky-400 dark:ring-sky-300 ring-offset-1 ring-offset-background z-10 scale-y-110"
                            )}
                          >
                            {/* Luminous violet portion for Reasoning/TTFT */}
                            {hasReasoning ? (
                              <div
                                className="h-full bg-violet-600 dark:bg-violet-500 shrink-0"
                                style={{ width: "35%" }}
                              />
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Lane 2: Tools */}
                  <div className="relative flex h-4 w-full items-center">
                    {items.map(({ item, lane, weight }) => {
                      if (lane !== 2) {
                        return <div key={`empty-2-${item.id}`} style={{ flex: weight }} className="h-full" />;
                      }
                      const isSelected = selectedItemId === item.id;

                      return (
                        <div
                          key={`slot-2-${item.id}`}
                          style={{ flex: weight }}
                          className="h-full flex px-[0.5px]"
                        >
                          <div
                            onClick={() => onSelectItem?.(item, turn)}
                            className={cn(
                              "h-full w-full rounded-[2px] cursor-pointer transition-all hover:brightness-110",
                              getItemColorClass(item),
                              isSelected && "ring-2 ring-sky-400 dark:ring-sky-300 ring-offset-1 ring-offset-background z-10 scale-y-110"
                            )}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
