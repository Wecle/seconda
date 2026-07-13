"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { parseAgentRunStreamEvent } from "@/lib/interview/agent/client-event";
import { agentRunEventsPath, nextReconnectDelay } from "@/lib/interview/agent/client-stream";
import { publicAgentEventTypes } from "@/lib/interview/agent/contracts";

export type { AgentRunStreamEvent } from "@/lib/interview/agent/client-event";
import type { AgentRunStreamEvent } from "@/lib/interview/agent/client-event";

export type AgentRunStreamStatus = {
  id: string;
  status: "running" | "completed" | "failed";
  exitReason: string | null;
  userMessage: string | null;
  lastEventSequence: number;
  recoveryDisposition?: "already_running" | "schedule" | "cooldown" | "exhausted" | "completed" | "failed";
};

export function useAgentRunStream(options: {
  interviewId: string;
  run: AgentRunStreamStatus | null;
  afterSequence?: number;
  onEvent: (event: AgentRunStreamEvent) => void | Promise<void>;
  onTerminal: (run: AgentRunStreamStatus) => void | Promise<void>;
  resumeRun?: (runId: string, signal: AbortSignal) => Promise<void>;
}) {
  const { afterSequence = 0, interviewId, onEvent, onTerminal, resumeRun, run } = options;
  const [connectionState, setConnectionState] = useState<
    "idle" | "connecting" | "open" | "reconnecting" | "recovering" | "manual_retry" | "terminal"
  >(run?.status === "running" && run.recoveryDisposition !== "exhausted" ? "connecting" : "idle");
  const [retryVersion, setRetryVersion] = useState(0);
  const cursorRef = useRef(afterSequence);
  const cursorRunRef = useRef<string | undefined>(run?.id);
  const callbacksRef = useRef({ onEvent, onTerminal });
  const resumeRunRef = useRef(resumeRun);
  const recoveryAttemptedRunRef = useRef<string | null>(null);
  callbacksRef.current = { onEvent, onTerminal };
  resumeRunRef.current = resumeRun;
  const runId = run?.id;
  const runStatus = run?.recoveryDisposition === "exhausted" ? "failed" : run?.status;

  const retry = useCallback(() => {
    cursorRef.current = Math.max(cursorRef.current, afterSequence);
    setConnectionState("connecting");
    setRetryVersion((value) => value + 1);
  }, [afterSequence]);

  useEffect(() => {
    if (!runId || runStatus !== "running") return;
    if (cursorRunRef.current !== runId) {
      cursorRunRef.current = runId;
      cursorRef.current = afterSequence;
    } else {
      cursorRef.current = Math.max(cursorRef.current, afterSequence);
    }
    let disposed = false;
    let source: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectAttempt = 0;
    const recoveryController = new AbortController();

    const connect = () => {
      if (disposed) return;
      source = new EventSource(agentRunEventsPath(interviewId, runId, cursorRef.current));
      source.onopen = () => {
        setConnectionState("open");
      };
      for (const type of publicAgentEventTypes) {
        source.addEventListener(type, (raw) => {
          reconnectAttempt = 0;
          const message = raw as MessageEvent;
          const event = parseAgentRunStreamEvent(type, message);
          if (!event || event.payload.runId !== runId) return;
          cursorRef.current = Math.max(cursorRef.current, event.sequence);
          void callbacksRef.current.onEvent(event);
          if (type === "run_completed" || type === "run_failed") {
            source?.close();
            setConnectionState("terminal");
          }
        });
      }
      source.onerror = async () => {
        source?.close();
        if (disposed) return;
        try {
          const response = await fetch(
            `/api/interviews/${interviewId}/runs/${runId}`,
            { cache: "no-store" },
          );
          if (!response.ok) throw new Error("Run status request failed");
          const status = await response.json() as AgentRunStreamStatus;
          if (status.status !== "running") {
            setConnectionState("terminal");
            await callbacksRef.current.onTerminal(status);
            return;
          }
        } catch {
          if (disposed) return;
        }
        const delay = nextReconnectDelay(reconnectAttempt);
        reconnectAttempt += 1;
        if (delay === null) {
          if (resumeRunRef.current && recoveryAttemptedRunRef.current !== runId) {
            recoveryAttemptedRunRef.current = runId;
            setConnectionState("recovering");
            try {
              await resumeRunRef.current(runId, recoveryController.signal);
              if (disposed) return;
              reconnectAttempt = 0;
              setConnectionState("reconnecting");
              reconnectTimer = setTimeout(connect, 0);
            } catch {
              if (!disposed) setConnectionState("manual_retry");
            }
            return;
          }
          setConnectionState("manual_retry");
          return;
        }
        setConnectionState("reconnecting");
        reconnectTimer = setTimeout(connect, delay);
      };
    };

    connect();
    return () => {
      disposed = true;
      recoveryController.abort();
      source?.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [afterSequence, interviewId, retryVersion, runId, runStatus]);

  return { connectionState, retry, lastSequence: cursorRef };
}
