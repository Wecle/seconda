"use client";

import { useId } from "react";
import { Brain, ChevronDown, Loader2, Search } from "lucide-react";
import type { LiveTurnState, ReasoningEntry } from "@/lib/interview/agent/room-state";
import { cn } from "@/lib/utils";

export function AgentThinkingPanel({ thinking, entries, active, onToggle }: {
  thinking: LiveTurnState["thinking"];
  entries: readonly ReasoningEntry[];
  active: boolean;
  onToggle: (expanded: boolean) => void;
}) {
  const contentId = useId();
  const label = thinking.failed ? "本轮思考未能完成" : active ? "面试官思考中" : "查看思考过程";

  return <div className="max-w-[86%] border-l-2 border-primary/20 pl-4 text-sm text-muted-foreground">
    <button
      type="button"
      aria-controls={contentId}
      aria-expanded={thinking.expanded}
      onClick={() => onToggle(!thinking.expanded)}
      className="flex items-center gap-2 rounded-sm py-1 font-medium transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      {active ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Brain className="size-4" aria-hidden="true" />}
      <span>{label}</span>
      <ChevronDown className={cn("size-4 transition-transform", thinking.expanded && "rotate-180")} aria-hidden="true" />
    </button>
    {thinking.expanded ? <div
      id={contentId}
      className="space-y-3 py-2 whitespace-pre-wrap [content-visibility:auto] motion-safe:animate-in motion-safe:fade-in"
      aria-live={active ? "polite" : "off"}
    >
      {entries.length > 0 ? entries.map((entry) => <ReasoningEntryView key={`${entry.attemptId}:${entry.entryId}`} entry={entry} />) : (
        <p>{active ? "正在分析回答内容与简历证据，规划下一步问题。" : "本轮没有可公开的思考记录。"}</p>
      )}
    </div> : null}
  </div>;
}

function ReasoningEntryView({ entry }: { entry: ReasoningEntry }) {
  const text = entry.kind === "reasoning" && !entry.text
    ? entry.status === "streaming"
      ? "正在分析回答内容与简历证据，规划下一步问题。"
      : "此步骤没有可公开的补充内容。"
    : entry.text;

  return <div className={cn("space-y-1", entry.discarded && "opacity-60")}>
    {entry.discarded ? <p className="text-xs font-medium text-muted-foreground">已调整方案</p> : null}
    <p className={cn(
      "leading-6",
      entry.kind === "tool" && "inline-flex items-center gap-2 rounded-md border bg-muted/40 px-2.5 py-1.5",
    )}>
      {entry.kind === "tool" ? <Search className="size-3.5 shrink-0" aria-hidden="true" /> : null}
      <span>{text}</span>
      {entry.status === "streaming" && entry.kind === "tool" ? <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden="true" /> : null}
    </p>
  </div>;
}
