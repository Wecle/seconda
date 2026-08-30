"use client";

import { useEffect, useState } from "react";

export interface InterviewTurn {
  questionId: string;
  roundIndex: number;
  topic?: string;
  questionContent: string;
  answerContent?: string;
  isSkipped?: boolean;
  isAnswered: boolean;
  isCurrent: boolean;
}

interface MagneticHighlightRailProps {
  className?: string;
  turns?: InterviewTurn[];
  scrollContainerRef?: React.RefObject<HTMLDivElement | null>;
}

export function MagneticHighlightRail({
  className = "",
  turns = [],
  scrollContainerRef,
}: MagneticHighlightRailProps) {
  const [activeTurnIds, setActiveTurnIds] = useState<string[]>([]);
  const [hoveredTurnId, setHoveredTurnId] = useState<string | null>(null);

  // Track viewport visibility for all turns using IntersectionObserver
  useEffect(() => {
    if (turns.length === 0) {
      setActiveTurnIds([]);
      return;
    }

    const viewportEl =
      scrollContainerRef?.current?.querySelector<HTMLElement>("[data-slot='scroll-area-viewport']") ||
      scrollContainerRef?.current ||
      null;

    const intersectingMap = new Map<string, boolean>();

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const turnId = entry.target.getAttribute("data-turn-id");
          if (turnId) {
            intersectingMap.set(turnId, entry.isIntersecting);
          }
        });

        const currentActive: string[] = [];
        turns.forEach((turn) => {
          if (intersectingMap.get(turn.questionId)) {
            currentActive.push(turn.questionId);
          }
        });
        setActiveTurnIds(currentActive);
      },
      {
        root: viewportEl,
        threshold: [0, 0.1, 0.5],
        rootMargin: "-40px 0px -40px 0px",
      },
    );

    turns.forEach((turn) => {
      const el = document.querySelector(`[data-turn-id="${turn.questionId}"]`);
      if (el) observer.observe(el);
    });

    return () => {
      observer.disconnect();
    };
  }, [turns, scrollContainerRef]);

  const handleJumpToTurn = (questionId: string) => {
    const el = document.querySelector(`[data-turn-id="${questionId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };

  if (turns.length === 0) return null;

  return (
    <div
      aria-hidden={false}
      className={`pointer-events-none absolute inset-y-0 left-0 z-30 w-24 select-none ${className}`}
    >
      {/* Background stationary reference track line */}
      <div className="absolute inset-y-0 left-0 w-px bg-border/25 pointer-events-none" />

      {/* Interactive Piano Keys Column */}
      <nav
        aria-label="面试轮次导航"
        className="absolute inset-y-0 left-0 flex flex-col justify-center gap-3 py-16 pl-0.5 pointer-events-auto"
      >
        {turns.map((turn) => {
          const isActive = activeTurnIds.includes(turn.questionId);
          const isHovered = hoveredTurnId === turn.questionId;

          return (
            <div
              key={turn.questionId}
              className="relative flex items-center"
              onMouseEnter={() => setHoveredTurnId(turn.questionId)}
              onMouseLeave={() => setHoveredTurnId(null)}
            >
              {/* Piano Key Button with prominent hover width expansion */}
              <button
                type="button"
                onClick={() => handleJumpToTurn(turn.questionId)}
                aria-label={`跳转至第 ${turn.roundIndex} 轮面试问答`}
                aria-current={isActive ? "true" : undefined}
                className="group flex h-11 w-14 cursor-pointer items-center justify-start focus-visible:outline-hidden"
              >
                <div
                  className={`transition-all duration-300 ease-out rounded-r-md ${
                    isHovered
                      ? "w-8 h-10.5 bg-primary shadow-[0_0_18px_var(--primary)] ring-1 ring-primary/50"
                      : isActive
                      ? "w-4 h-10 bg-primary shadow-[0_0_12px_var(--primary)] ring-1 ring-primary/40"
                      : "w-2.5 h-8 bg-muted-foreground/35 group-hover:bg-primary/80"
                  }`}
                />
                <span
                  className={`ml-2 text-[11px] font-mono font-medium transition-all duration-200 ${
                    isHovered || isActive
                      ? "text-primary opacity-100 font-bold"
                      : "text-muted-foreground/60 opacity-0 group-hover:opacity-100"
                  }`}
                >
                  {turn.roundIndex}
                </span>
              </button>

              {/* Minimalist Hover Preview Card */}
              {isHovered && (
                <div
                  role="tooltip"
                  className="absolute left-16 top-1/2 z-50 w-72 sm:w-80 -translate-y-1/2 rounded-xl border border-border/80 bg-card/95 p-3 shadow-xl backdrop-blur-md text-left animate-in fade-in zoom-in-95 duration-150 pointer-events-auto max-h-80 overflow-y-auto"
                >
                  {/* Single-line bold enlarged question title */}
                  <h4
                    title={turn.questionContent}
                    className="truncate text-[13px] font-bold text-foreground tracking-tight"
                  >
                    {turn.questionContent}
                  </h4>

                  {/* Answer content */}
                  <p
                    className={`mt-1.5 line-clamp-4 text-xs leading-relaxed break-words font-sans ${
                      turn.isSkipped || !turn.answerContent
                        ? "italic text-muted-foreground/75"
                        : "text-muted-foreground"
                    }`}
                  >
                    {turn.isSkipped
                      ? "已跳过回答"
                      : turn.answerContent || "等待作答中..."}
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </div>
  );
}
