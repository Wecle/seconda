"use client";

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AgentArtifactCard } from "./agent-artifact-card";
import { AgentThinkingPanel } from "./agent-thinking-panel";
import type { CommittedArtifact } from "@/lib/interview/agent/contracts";
import type { LiveTurnState } from "@/lib/interview/agent/room-state";

const markdownPlugins = [remarkGfm];
const noArtifacts: readonly CommittedArtifact[] = [];

export const AgentLiveTurn = memo(function AgentLiveTurn({ turn, artifacts = noArtifacts, active, onToggle }: {
  turn: LiveTurnState;
  artifacts?: readonly CommittedArtifact[];
  active: boolean;
  onToggle: (expanded: boolean) => void;
}) {
  const showThinking = active || turn.reasoningEntries.length > 0 || turn.thinking.failed;
  if (!showThinking && artifacts.length === 0 && !turn.provisionalResponse) return null;

  return <div className="space-y-3">
    {showThinking ? <AgentThinkingPanel
      thinking={turn.thinking}
      entries={turn.reasoningEntries}
      active={active && !turn.responseStarted}
      onToggle={onToggle}
    /> : null}
    {artifacts.map((artifact) => <AgentArtifactCard key={artifact.artifactId} artifact={artifact} />)}
    {turn.provisionalResponse ? <div
      className="max-w-[86%] rounded-2xl rounded-bl-md border bg-card px-5 py-4 shadow-sm [content-visibility:auto]"
      aria-live="polite"
    >
      <ReactMarkdown remarkPlugins={markdownPlugins}>{turn.provisionalResponse}</ReactMarkdown>
    </div> : null}
  </div>;
});
