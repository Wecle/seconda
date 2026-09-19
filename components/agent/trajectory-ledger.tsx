"use client";

import { useMemo, useState } from "react";
import {
  BrainCircuit,
  ChevronDown,
  Clock,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type {
  TrajectoryItem,
  TrajectoryItemRole,
  TrajectoryStep,
  TrajectoryToolCall,
  TrajectoryTurn,
} from "@/lib/agent/types";
import {
  TrajectoryTimeline,
  type TimelineLane,
} from "./trajectory-timeline";

export interface TrajectoryLedgerProps {
  turns: TrajectoryTurn[];
  activeRunId?: string | null;
  selectedItemId?: string | null;
  onSelectItem?: (item: TrajectoryItem, turn: TrajectoryTurn) => void;
  onInspectStep?: (step: TrajectoryStep) => void;
  onInspectTool?: (tool: TrajectoryToolCall) => void;
  onForkCheckpoint?: (sequence: number) => void;
  className?: string;
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

export function TrajectoryLedger({
  turns,
  selectedItemId,
  onSelectItem,
  className,
}: TrajectoryLedgerProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [durationMode, setDurationMode] = useState<"sequence" | "duration">("sequence");
  const [allTurnsCollapsed, setAllTurnsCollapsed] = useState(false);
  const [collapsedTurnIds, setCollapsedTurnIds] = useState<Set<number>>(new Set());
  const [callsOnly, setCallsOnly] = useState(false);
  const [activeLaneFilter, setActiveLaneFilter] = useState<TimelineLane>("all");

  const toggleTurnCollapse = (turnIndex: number) => {
    setCollapsedTurnIds((prev) => {
      const next = new Set(prev);
      if (next.has(turnIndex)) {
        next.delete(turnIndex);
      } else {
        next.add(turnIndex);
      }
      return next;
    });
  };

  const handleToggleAllTurns = () => {
    if (allTurnsCollapsed) {
      setCollapsedTurnIds(new Set());
      setAllTurnsCollapsed(false);
    } else {
      setCollapsedTurnIds(new Set(turns.map((t) => t.turnIndex)));
      setAllTurnsCollapsed(true);
    }
  };

  const filteredTurns = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();

    return turns
      .map((turn) => {
        let matchingItems = turn.items;

        // Calls only filter
        if (callsOnly) {
          matchingItems = matchingItems.filter(
            (item) => item.role === "tool" || item.role === "assistant",
          );
        }

        // Lane filter
        if (activeLaneFilter === "input") {
          matchingItems = matchingItems.filter(
            (item) => item.role === "system" || item.role === "context" || item.role === "user",
          );
        } else if (activeLaneFilter === "model") {
          matchingItems = matchingItems.filter(
            (item) => item.role === "assistant" || item.role === "outcome",
          );
        } else if (activeLaneFilter === "tools") {
          matchingItems = matchingItems.filter((item) => item.role === "tool");
        }

        // Text search filter
        if (query) {
          matchingItems = matchingItems.filter(
            (item) =>
              item.title.toLowerCase().includes(query) ||
              item.preview.toLowerCase().includes(query) ||
              item.content.toLowerCase().includes(query) ||
              item.role.toLowerCase().includes(query),
          );
        }

        return {
          ...turn,
          items: matchingItems,
        };
      })
      .filter((turn) => turn.items.length > 0);
  }, [turns, searchQuery, callsOnly, activeLaneFilter]);

  if (turns.length === 0) {
    return (
      <div className="grid place-items-center py-20 text-center text-muted-foreground">
        <div className="max-w-md space-y-3">
          <div className="mx-auto grid size-12 place-items-center rounded-xl border bg-muted/40">
            <BrainCircuit className="size-6 text-muted-foreground" />
          </div>
          <h3 className="text-sm font-semibold text-foreground">暂无执行轨迹</h3>
          <p className="text-xs leading-relaxed">
            Agent 开始思考、对话与调用工具后，高保真消息轨迹与时序遥测将在此处实时呈现。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("space-y-4 text-xs", className)}>
      {/* 1. DSH-Aligned Interactive Trajectory Timeline & Toolbar */}
      <TrajectoryTimeline
        turns={turns}
        selectedItemId={selectedItemId}
        onSelectItem={onSelectItem}
        durationMode={durationMode}
        onToggleDurationMode={() =>
          setDurationMode((prev) => (prev === "sequence" ? "duration" : "sequence"))
        }
        allTurnsCollapsed={allTurnsCollapsed}
        onToggleAllTurns={handleToggleAllTurns}
        callsOnly={callsOnly}
        onToggleCallsOnly={() => setCallsOnly((prev) => !prev)}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        activeLaneFilter={activeLaneFilter}
        onLaneFilterChange={setActiveLaneFilter}
      />

      {/* 2. Turn Message Stream (Turn-Aware Event Ledger) */}
      <div className="space-y-4">
        {filteredTurns.map((turn) => {
          const isCollapsed = collapsedTurnIds.has(turn.turnIndex);

          return (
            <section
              key={`turn-${turn.turnIndex}`}
              className={cn(
                "rounded-xl border bg-card/70 p-3.5 shadow-2xs space-y-2.5 transition-all",
                turn.status === "failed" && "border-destructive/40 bg-destructive/5"
              )}
            >
              {/* Turn Header with Highlighted Status and Total Tokens */}
              <div
                onClick={() => toggleTurnCollapse(turn.turnIndex)}
                className="flex items-center justify-between gap-2 px-1 cursor-pointer select-none"
              >
                <div className="flex items-center gap-2.5 flex-wrap">
                  <Badge
                    variant="outline"
                    className="font-mono text-[11px] font-bold px-2 py-0.5 bg-background border-primary/40 text-primary"
                  >
                    Turn {turn.turnIndex}
                  </Badge>

                  <span className="text-xs text-muted-foreground font-medium">
                    {turn.trigger.type === "candidate_answer"
                      ? "候选人作答"
                      : turn.trigger.type === "opening_trigger"
                        ? "开场轮次"
                        : turn.trigger.type === "candidate_skip"
                          ? "候选人跳过"
                          : "用户交互"}
                  </span>

                  {/* Highlighted Status Badge (Requirement 3: fail, completed) */}
                  {turn.status === "completed" ? (
                    <Badge className="font-mono text-[10px] font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 px-2 py-0.5 shadow-2xs">
                      COMPLETED
                    </Badge>
                  ) : turn.status === "failed" ? (
                    <Badge className="font-mono text-[10px] font-bold bg-destructive/15 text-destructive border border-destructive/30 px-2 py-0.5 shadow-2xs">
                      FAILED
                    </Badge>
                  ) : (
                    <Badge className="font-mono text-[10px] font-bold bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/30 px-2 py-0.5 animate-pulse">
                      RUNNING
                    </Badge>
                  )}

                  {/* Total Tokens for this Turn (Requirement 2) */}
                  {turn.totalMetrics.totalTokens > 0 ? (
                    <div className="flex items-center gap-1.5">
                      <Badge
                        variant="secondary"
                        className="font-mono text-[10px] font-semibold px-2 py-0.5 bg-muted/80 text-foreground border border-border/70"
                      >
                        <Sparkles className="size-3 text-amber-500 inline mr-1" />
                        {turn.totalMetrics.totalTokens.toLocaleString()} tokens
                      </Badge>
                      <span className="hidden sm:inline text-[10px] font-mono text-muted-foreground">
                        (in: {turn.totalMetrics.inputTokens.toLocaleString()} · out: {turn.totalMetrics.outputTokens.toLocaleString()})
                      </span>
                    </div>
                  ) : null}
                </div>

                <div className="flex items-center gap-3 font-mono text-[11px] text-muted-foreground">
                  {turn.totalMetrics.durationMs > 0 ? (
                    <span className="flex items-center gap-1">
                      <Clock className="size-3" />
                      {turn.totalMetrics.durationMs > 1000
                        ? `${(turn.totalMetrics.durationMs / 1000).toFixed(1)}s`
                        : `${turn.totalMetrics.durationMs}ms`}
                    </span>
                  ) : null}

                  <ChevronDown
                    className={cn(
                      "size-4 transition-transform duration-200",
                      isCollapsed && "-rotate-90"
                    )}
                  />
                </div>
              </div>

              {/* Items List (Collapsible) */}
              {!isCollapsed ? (
                <div className="space-y-1.5 pl-1.5 border-l-2 border-border/60 ml-2.5 pt-1">
                  {turn.items.map((item) => {
                    const isSelected = selectedItemId === item.id;
                    const isFailed = item.status === "failed";

                    return (
                      <div
                        key={item.id}
                        onClick={() => onSelectItem?.(item, turn)}
                        className={cn(
                          "group relative flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-xs transition-all cursor-pointer select-none",
                          isSelected
                            ? "border-sky-500 bg-sky-500/10 dark:bg-sky-500/15 ring-1 ring-sky-400/50 shadow-xs text-foreground font-medium"
                            : isFailed
                              ? "border-destructive/60 bg-destructive/10 text-destructive hover:bg-destructive/15"
                              : "border-transparent bg-muted/25 hover:bg-muted/60 hover:border-border text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {/* Left: Role Badge & Title/Preview */}
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                          <span
                            className={cn(
                              "px-2 py-0.5 rounded font-mono text-[10px] font-bold tracking-wider shrink-0 border uppercase",
                              roleBadgeStyle(item.role)
                            )}
                          >
                            {item.role}
                          </span>
                          <span
                            className={cn(
                              "truncate text-xs group-hover:text-foreground",
                              isFailed ? "text-destructive font-semibold" : "text-foreground/90"
                            )}
                          >
                            {item.role === "system"
                              ? "Initial System Prompt"
                              : item.preview || item.title}
                          </span>
                        </div>

                        {/* Right: Duration / Metrics / Highlighted Status */}
                        <div className="flex items-center gap-2 shrink-0 font-mono text-[11px] text-muted-foreground">
                          {isFailed ? (
                            <Badge
                              variant="destructive"
                              className="h-5 px-1.5 text-[9px] font-bold uppercase tracking-wider"
                            >
                              FAILED
                            </Badge>
                          ) : null}

                          {item.role === "tool" && item.durationMs !== undefined ? (
                            <Badge variant="outline" className="h-5 px-1.5 text-[10px] font-mono">
                              {item.durationMs}ms
                            </Badge>
                          ) : null}

                          {item.role === "assistant" && item.durationMs !== undefined ? (
                            <span className="text-[10px]">
                              {item.durationMs}ms
                            </span>
                          ) : null}

                          {item.status === "running" ? (
                            <span className="size-2 rounded-full bg-blue-500 animate-ping" />
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}
