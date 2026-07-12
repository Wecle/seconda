"use client";

import { Brain, ChevronDown, Loader2 } from "lucide-react";
import type { RoomTurn } from "@/lib/interview/agent/room-state";

export function AgentThinkingPanel({ thinking, active, onToggle }: {
  thinking: RoomTurn["thinking"];
  active: boolean;
  onToggle: (expanded: boolean) => void;
}) {
  const label = thinking.failed ? "本轮思考未能完成" : active ? "面试官思考中" : "查看思考过程";
  return <div className="max-w-[86%] border-l-2 border-primary/20 pl-4 text-sm text-muted-foreground">
    <button type="button" aria-expanded={thinking.expanded} onClick={() => onToggle(!thinking.expanded)} className="flex items-center gap-2 py-1 font-medium hover:text-foreground">
      {active ? <Loader2 className="size-4 animate-spin" /> : <Brain className="size-4" />}{label}<ChevronDown className={`size-4 transition-transform ${thinking.expanded ? "rotate-180" : ""}`} />
    </button>
    {thinking.expanded && <div className="space-y-2 py-2 motion-safe:animate-in motion-safe:fade-in">
      {thinking.entries.length > 0 ? thinking.entries.map((entry) => <p key={entry.entryId}>{entry.summary}</p>) : <p>正在分析回答内容与简历证据，规划下一步问题。</p>}
    </div>}
  </div>;
}
