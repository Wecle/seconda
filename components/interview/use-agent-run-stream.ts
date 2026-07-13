"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { nextReconnectDelay } from "@/lib/interview/agent/client-stream";

export type AgentRunStreamStatus = {
  id: string;
  status: "running" | "completed" | "failed";
  exitReason: string | null;
  userMessage: string | null;
  lastEventSequence: number;
};

export type AgentRunStreamEvent = {
  type: string;
  sequence: number;
  payload: unknown;
};

const eventTypes = [
  "run_started",
  "thinking_started",
  "thinking_summary",
  "response_started",
  "artifact_committed",
  "scoring_progress",
  "reporting_started",
  "model_started",
  "text_delta",
  "warning",
  "checkpoint",
  "compacted",
  "message_committed",
  "run_completed",
  "run_failed",
];

export function useAgentRunStream(options: {
  interviewId: string;
  run: AgentRunStreamStatus | null;
  afterSequence?: number;
  onEvent: (event: AgentRunStreamEvent) => void | Promise<void>;
  onTerminal: (run: AgentRunStreamStatus) => void | Promise<void>;
}) {
  const [connectionState, setConnectionState] = useState<
    "idle" | "connecting" | "open" | "reconnecting" | "manual_retry" | "terminal"
  >(options.run?.status === "running" ? "connecting" : "idle");
  const [retryVersion, setRetryVersion] = useState(0);
  const cursorRef = useRef(options.afterSequence ?? 0);
  const cursorRunRef = useRef<string | undefined>(options.run?.id);
  const callbacksRef = useRef({ onEvent: options.onEvent, onTerminal: options.onTerminal });
  callbacksRef.current = { onEvent: options.onEvent, onTerminal: options.onTerminal };
  const runId = options.run?.id;
  const runStatus = options.run?.status;

  const retry = useCallback(() => {
    cursorRef.current = Math.max(cursorRef.current, options.afterSequence ?? 0);
    setConnectionState("connecting");
    setRetryVersion((value) => value + 1);
  }, [options.afterSequence]);

  useEffect(() => {
    if (!runId || runStatus !== "running") return;
    if (cursorRunRef.current !== runId) {
      cursorRunRef.current = runId;
      cursorRef.current = options.afterSequence ?? 0;
    }
    let disposed = false;
    let source: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectAttempt = 0;

    const connect = () => {
      if (disposed) return;
      source = new EventSource(
        `/api/interviews/${options.interviewId}/runs/${runId}/events?after=${cursorRef.current}`,
      );
      source.onopen = () => {
        reconnectAttempt = 0;
        setConnectionState("open");
      };
      for (const type of eventTypes) {
        source.addEventListener(type, (raw) => {
          const message = raw as MessageEvent;
          const sequence = Number(message.lastEventId);
          if (Number.isInteger(sequence)) cursorRef.current = Math.max(cursorRef.current, sequence);
          const event = {
            type,
            sequence: Number.isInteger(sequence) ? sequence : cursorRef.current,
            payload: safeJson(message.data),
          };
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
            `/api/interviews/${options.interviewId}/runs/${runId}`,
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
      source?.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [options.afterSequence, options.interviewId, retryVersion, runId, runStatus]);

  return { connectionState, retry, lastSequence: cursorRef };
}

function safeJson(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}
