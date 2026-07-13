"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { nextCompletionPoll, shouldAutoResumeCompletion } from "@/lib/interview/completion/polling";

export function useCompletionPolling(options: {
  active: boolean;
  status: string;
  refresh: (signal: AbortSignal) => Promise<void>;
  resume?: (signal: AbortSignal) => Promise<void>;
}) {
  const [timedOut, setTimedOut] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [restartVersion, setRestartVersion] = useState(0);
  const refreshRef = useRef(options.refresh);
  const resumeRef = useRef(options.resume);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const resumeInFlightRef = useRef<Promise<void> | null>(null);
  const autoResumeAttemptedRef = useRef(false);

  useEffect(() => {
    refreshRef.current = options.refresh;
    resumeRef.current = options.resume;
  }, [options.refresh, options.resume]);

  const refreshNow = useCallback(async (signal?: AbortSignal) => {
    if (inFlightRef.current) return inFlightRef.current;
    const controller = signal ? null : new AbortController();
    const task = refreshRef.current(signal ?? controller!.signal).finally(() => {
      if (inFlightRef.current === task) inFlightRef.current = null;
    });
    inFlightRef.current = task;
    return task;
  }, []);

  const resumeNow = useCallback(async (signal?: AbortSignal) => {
    if (!resumeRef.current) return;
    if (resumeInFlightRef.current) return resumeInFlightRef.current;
    const controller = signal ? null : new AbortController();
    setResuming(true);
    const task = resumeRef.current(signal ?? controller!.signal).finally(() => {
      if (resumeInFlightRef.current === task) resumeInFlightRef.current = null;
      setResuming(false);
    });
    resumeInFlightRef.current = task;
    return task;
  }, []);

  const resumePolling = useCallback(() => {
    setTimedOut(false);
    setRestartVersion((value) => value + 1);
  }, []);

  useEffect(() => {
    if (!options.active) autoResumeAttemptedRef.current = false;
  }, [options.active]);

  useEffect(() => {
    if (!options.active) return;
    const controller = new AbortController();
    let startedAt = Date.now();
    let pausedAt: number | null = null;
    let pausedMs = 0;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const schedule = () => {
      if (disposed) return;
      const decision = nextCompletionPoll({
        attempt,
        elapsedMs: Date.now() - startedAt - pausedMs,
        status: options.status,
        visible: document.visibilityState === "visible",
        online: navigator.onLine,
      });
      if (decision === null) {
        const timedOutNow = !["completed", "failed"].includes(options.status);
        if (shouldAutoResumeCompletion({
          active: options.active,
          timedOut: timedOutNow,
          alreadyAttempted: autoResumeAttemptedRef.current,
          status: options.status,
        }) && resumeRef.current) {
          autoResumeAttemptedRef.current = true;
          void resumeNow(controller.signal).then(() => {
            if (disposed) return;
            setTimedOut(false);
            startedAt = Date.now();
            pausedAt = null;
            pausedMs = 0;
            attempt = 0;
            schedule();
          }).catch(() => {
            if (!disposed) setTimedOut(true);
          });
          return;
        }
        if (timedOutNow) setTimedOut(true);
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
    const syncAvailability = () => {
      const paused = document.visibilityState !== "visible" || !navigator.onLine;
      if (paused) {
        if (timer) clearTimeout(timer);
        timer = null;
        pausedAt ??= Date.now();
        return;
      }
      if (pausedAt !== null) {
        pausedMs += Date.now() - pausedAt;
        pausedAt = null;
      }
      if (!timer) schedule();
    };
    schedule();
    document.addEventListener("visibilitychange", syncAvailability);
    window.addEventListener("online", syncAvailability);
    window.addEventListener("offline", syncAvailability);
    return () => {
      disposed = true;
      controller.abort();
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", syncAvailability);
      window.removeEventListener("online", syncAvailability);
      window.removeEventListener("offline", syncAvailability);
    };
  }, [options.active, options.status, refreshNow, restartVersion, resumeNow]);

  return { timedOut: options.active && timedOut, resuming, refreshNow, resumeNow, resumePolling };
}
