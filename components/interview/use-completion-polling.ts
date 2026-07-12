"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { nextCompletionPoll } from "@/lib/interview/completion/polling";

export function useCompletionPolling(options: {
  active: boolean;
  status: string;
  refresh: (signal: AbortSignal) => Promise<void>;
}) {
  const [timedOut, setTimedOut] = useState(false);
  const refreshRef = useRef(options.refresh);
  const inFlightRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    refreshRef.current = options.refresh;
  }, [options.refresh]);

  const refreshNow = useCallback(async (signal?: AbortSignal) => {
    if (inFlightRef.current) return inFlightRef.current;
    const controller = signal ? null : new AbortController();
    const task = refreshRef.current(signal ?? controller!.signal).finally(() => {
      if (inFlightRef.current === task) inFlightRef.current = null;
    });
    inFlightRef.current = task;
    return task;
  }, []);

  useEffect(() => {
    if (!options.active) return;
    const controller = new AbortController();
    const startedAt = Date.now();
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const schedule = () => {
      if (disposed) return;
      const decision = nextCompletionPoll({
        attempt,
        elapsedMs: Date.now() - startedAt,
        status: options.status,
        visible: document.visibilityState === "visible",
        online: navigator.onLine,
      });
      if (decision === null) {
        if (!["completed", "failed"].includes(options.status)) setTimedOut(true);
        return;
      }
      if (decision === "paused") return;
      timer = setTimeout(async () => {
        timer = null;
        try { await refreshNow(controller.signal); } catch {}
        attempt += 1;
        schedule();
      }, decision);
    };
    const resume = () => { if (!timer) schedule(); };
    schedule();
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    return () => {
      disposed = true;
      controller.abort();
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
    };
  }, [options.active, options.status, refreshNow]);

  return { timedOut: options.active && timedOut, refreshNow };
}
