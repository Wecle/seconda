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

  const resetRatio = useCallback(() => {
    setLeftRatio(defaultRatio);
  }, [defaultRatio]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    setIsDragging(true);
  }, []);

  useEffect(() => {
    function handlePointerMove(e: PointerEvent) {
      if (!isDraggingRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const relativeX = e.clientX - rect.left;
      const targetRatio = relativeX / rect.width;
      const clamped = clampRatio(targetRatio, rect.width, minLeft, minRight);
      setLeftRatio(clamped);
    }

    function handlePointerUp() {
      if (isDraggingRef.current) {
        isDraggingRef.current = false;
        setIsDragging(false);
      }
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [containerRef, minLeft, minRight]);

  return {
    leftRatio,
    isDragging,
    handlePointerDown,
    resetRatio,
  };
}
