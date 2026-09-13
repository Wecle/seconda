import { useState, useCallback, useEffect, useRef } from "react";

export function clampRatio(
  targetRatio: number,
  containerWidth: number,
  minLeft: number,
  minRight: number,
): number {
  if (containerWidth <= 0) return 0.55;
  if (minLeft + minRight >= containerWidth) {
    return minLeft / (minLeft + minRight);
  }
  const minRatio = minLeft / containerWidth;
  const maxRatio = 1 - minRight / containerWidth;
  return Math.max(minRatio, Math.min(maxRatio, targetRatio));
}

interface UseResizableColumnsOptions {
  containerRef: React.RefObject<HTMLElement | null>;
  minLeft?: number;
  minRight?: number;
  defaultRatio?: number;
}

export function useResizableColumns({
  containerRef,
  minLeft = 420,
  minRight = 380,
  defaultRatio = 0.55,
}: UseResizableColumnsOptions) {
  const [leftRatio, setLeftRatio] = useState(defaultRatio);
  const [isDragging, setIsDragging] = useState(false);
  const isDraggingRef = useRef(false);
  const latestRatioRef = useRef(defaultRatio);
  const containerRectRef = useRef<DOMRect | null>(null);
  const rafIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.style.setProperty("--left-ratio", String(leftRatio));
    }
  }, [containerRef, leftRatio]);

  const resetRatio = useCallback(() => {
    latestRatioRef.current = defaultRatio;
    setLeftRatio(defaultRatio);
    if (containerRef.current) {
      containerRef.current.style.setProperty("--left-ratio", String(defaultRatio));
    }
  }, [containerRef, defaultRatio]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      if (!containerRef.current) return;

      containerRectRef.current = containerRef.current.getBoundingClientRect();
      isDraggingRef.current = true;
      setIsDragging(true);

      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // ignore if not supported
      }
    },
    [containerRef],
  );

  useEffect(() => {
    if (!isDragging) return;

    function handlePointerMove(e: PointerEvent) {
      if (!isDraggingRef.current) return;

      const rect = containerRectRef.current ?? containerRef.current?.getBoundingClientRect();
      if (!rect || rect.width <= 0) return;

      const relativeX = e.clientX - rect.left;
      const targetRatio = relativeX / rect.width;
      const clamped = clampRatio(targetRatio, rect.width, minLeft, minRight);
      latestRatioRef.current = clamped;

      if (rafIdRef.current === null) {
        rafIdRef.current = requestAnimationFrame(() => {
          rafIdRef.current = null;
          if (containerRef.current) {
            containerRef.current.style.setProperty("--left-ratio", String(latestRatioRef.current));
          }
        });
      }
    }

    function handlePointerUp() {
      if (isDraggingRef.current) {
        isDraggingRef.current = false;
        setIsDragging(false);
        if (rafIdRef.current !== null) {
          cancelAnimationFrame(rafIdRef.current);
          rafIdRef.current = null;
        }
        if (containerRef.current) {
          containerRef.current.style.setProperty("--left-ratio", String(latestRatioRef.current));
        }
        setLeftRatio(latestRatioRef.current);
      }
    }

    const originalCursor = document.body.style.cursor;
    const originalUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);

    return () => {
      document.body.style.cursor = originalCursor;
      document.body.style.userSelect = originalUserSelect;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [containerRef, isDragging, minLeft, minRight]);

  useEffect(() => {
    if (!containerRef.current || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentRect.width;
        if (width > 0 && !isDraggingRef.current) {
          const clamped = clampRatio(latestRatioRef.current, width, minLeft, minRight);
          if (clamped !== latestRatioRef.current) {
            latestRatioRef.current = clamped;
            setLeftRatio(clamped);
            containerRef.current?.style.setProperty("--left-ratio", String(clamped));
          }
        }
      }
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [containerRef, minLeft, minRight]);

  return {
    leftRatio,
    isDragging,
    handlePointerDown,
    resetRatio,
  };
}
