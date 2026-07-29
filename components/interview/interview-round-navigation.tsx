"use client";

import {
  memo,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type RefObject,
} from "react";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";
import {
  visibleGroupIds,
  type InterviewQuestionAnswerGroup,
} from "./interview-round-groups";

const magneticRadius = 40;

type RailMarkStyle = CSSProperties & {
  "--rail-energy": number;
  "--rail-pointer-x": string;
};

type RailPointer = {
  x: number;
  y: number;
};

type RailMarkGeometry = {
  top: number;
  height: number;
  left: number;
  width: number;
  focusActive: boolean;
};

export function magneticEnergy(distance: number, radius: number) {
  if (radius <= 0 || distance >= radius) return 0;
  const normalized = 1 - Math.max(0, distance) / radius;
  return normalized * normalized * (3 - 2 * normalized);
}

export function navigationScrollBehavior(reduceMotion: boolean): ScrollBehavior {
  return reduceMotion ? "auto" : "smooth";
}

export function railFocusFeedback(focused: boolean) {
  return focused
    ? { energy: 1, previewOpen: true, status: "active" as const }
    : { energy: 0, previewOpen: false, status: "inactive" as const };
}

export function roundPreviewCopy(group: InterviewQuestionAnswerGroup) {
  return {
    question: group.question.content,
    answer: group.answer?.content ?? "等待回答",
  };
}

export function calculateRailMarkUpdates(
  geometries: readonly RailMarkGeometry[],
  pointer: RailPointer,
) {
  return geometries.map((geometry) => {
    const distance = Math.abs(
      pointer.y - (geometry.top + geometry.height / 2),
    );
    const energy = Math.max(
      magneticEnergy(distance, magneticRadius),
      railFocusFeedback(geometry.focusActive).energy,
    );
    const pointerPercentage = geometry.width === 0
      ? 50
      : Math.min(
        100,
        Math.max(0, ((pointer.x - geometry.left) / geometry.width) * 100),
      );

    return { energy, pointerPercentage };
  });
}

export function cancelScheduledFrame(
  frameId: number | null,
  cancelFrame: (frameId: number) => void,
) {
  if (frameId !== null) cancelFrame(frameId);
  return null;
}

export const InterviewRoundNavigation = memo(function InterviewRoundNavigation({
  groups,
  scrollRootRef,
  getMessageElement,
}: {
  groups: readonly InterviewQuestionAnswerGroup[];
  scrollRootRef: RefObject<HTMLDivElement | null>;
  getMessageElement: (messageId: string) => HTMLElement | null;
}) {
  const railRef = useRef<HTMLElement | null>(null);
  const latestPointerRef = useRef<RailPointer | null>(null);
  const pendingFrameRef = useRef<number | null>(null);
  const [visibleIds, setVisibleIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  useEffect(() => () => {
    pendingFrameRef.current = cancelScheduledFrame(
      pendingFrameRef.current,
      cancelAnimationFrame,
    );
    latestPointerRef.current = null;
  }, []);

  useEffect(() => {
    const root = scrollRootRef.current;
    if (!root || groups.length === 0) return;

    const visibleMessageIds = new Set<string>();
    const elements: HTMLElement[] = [];
    for (const group of groups) {
      const question = getMessageElement(group.question.id);
      if (question) elements.push(question);
      if (group.answer) {
        const answer = getMessageElement(group.answer.id);
        if (answer) elements.push(answer);
      }
    }

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const messageId = (entry.target as HTMLElement).dataset.messageId;
        if (!messageId) continue;
        if (entry.isIntersecting) visibleMessageIds.add(messageId);
        else visibleMessageIds.delete(messageId);
      }
      setVisibleIds(visibleGroupIds(groups, visibleMessageIds));
    }, { root, threshold: 0 });

    for (const element of elements) observer.observe(element);
    return () => {
      observer.disconnect();
      visibleMessageIds.clear();
    };
  }, [getMessageElement, groups, scrollRootRef]);

  if (groups.length === 0) return null;

  const resetMarks = () => {
    const marks = railRef.current?.querySelectorAll<HTMLElement>(
      "[data-round-navigation-mark]",
    );
    marks?.forEach((mark) => {
      const feedback = railFocusFeedback(
        mark.dataset.focusFeedback === "active",
      );
      mark.style.setProperty("--rail-energy", String(feedback.energy));
      mark.style.setProperty("--rail-pointer-x", "50%");
    });
  };

  const handlePointerMove = (event: PointerEvent<HTMLElement>) => {
    latestPointerRef.current = { x: event.clientX, y: event.clientY };
    if (pendingFrameRef.current !== null) return;

    pendingFrameRef.current = requestAnimationFrame(() => {
      pendingFrameRef.current = null;
      const pointer = latestPointerRef.current;
      if (!pointer) return;

      const marks = railRef.current?.querySelectorAll<HTMLElement>(
        "[data-round-navigation-mark]",
      );
      if (!marks) return;

      const readings = Array.from(marks, (mark) => {
        const rect = mark.getBoundingClientRect();
        return {
          mark,
          geometry: {
            top: rect.top,
            height: rect.height,
            left: rect.left,
            width: rect.width,
            focusActive: mark.dataset.focusFeedback === "active",
          },
        };
      });
      const updates = calculateRailMarkUpdates(
        readings.map((reading) => reading.geometry),
        pointer,
      );

      readings.forEach(({ mark }, index) => {
        const update = updates[index];
        mark.style.setProperty("--rail-energy", update.energy.toFixed(4));
        mark.style.setProperty(
          "--rail-pointer-x",
          `${update.pointerPercentage}%`,
        );
      });
    });
  };

  const handlePointerLeave = () => {
    pendingFrameRef.current = cancelScheduledFrame(
      pendingFrameRef.current,
      cancelAnimationFrame,
    );
    latestPointerRef.current = null;
    resetMarks();
  };

  const navigate = (group: InterviewQuestionAnswerGroup) => {
    const element = getMessageElement(group.question.id);
    if (!element) return;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    element.scrollIntoView({
      behavior: navigationScrollBehavior(reduceMotion),
      block: "center",
    });
  };

  return (
    <nav
      ref={railRef}
      aria-label="面试问答导航"
      className="absolute -left-16 top-1/2 z-20 hidden -translate-y-1/2 flex-col py-2 xl:flex"
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    >
      {groups.map((group) => (
        <RoundNavigationMark
          key={group.id}
          group={group}
          visible={visibleIds.has(group.id)}
          onNavigate={() => navigate(group)}
        />
      ))}
    </nav>
  );
});

export function RoundNavigationMark({
  group,
  visible,
  onNavigate,
}: {
  group: InterviewQuestionAnswerGroup;
  visible: boolean;
  onNavigate: () => void;
}) {
  const [hoverOpen, setHoverOpen] = useState(false);
  const [focusOpen, setFocusOpen] = useState(false);
  const focusFeedback = railFocusFeedback(focusOpen);
  const preview = roundPreviewCopy(group);
  const style: RailMarkStyle = {
    "--rail-energy": focusFeedback.energy,
    "--rail-pointer-x": "50%",
  };

  return (
    <HoverCard
      open={hoverOpen || focusOpen}
      onOpenChange={setHoverOpen}
      openDelay={120}
      closeDelay={80}
    >
      <HoverCardTrigger asChild>
        <button
          type="button"
          data-round-navigation-mark
          data-resting-width="equal"
          data-focus-feedback={focusFeedback.status}
          aria-label={`${visible ? "当前视口内" : "当前视口外"}，查看并定位：${group.question.content.slice(0, 80)}`}
          className="group/mark relative flex h-5 w-12 items-center"
          style={style}
          onClick={onNavigate}
          onFocus={(event) => {
            const feedback = railFocusFeedback(true);
            setFocusOpen(feedback.previewOpen);
            event.currentTarget.dataset.focusFeedback = feedback.status;
            event.currentTarget.style.setProperty(
              "--rail-energy",
              String(feedback.energy),
            );
            event.currentTarget.style.setProperty("--rail-pointer-x", "50%");
          }}
          onBlur={(event) => {
            const feedback = railFocusFeedback(false);
            setFocusOpen(feedback.previewOpen);
            event.currentTarget.dataset.focusFeedback = feedback.status;
            event.currentTarget.style.setProperty(
              "--rail-energy",
              String(feedback.energy),
            );
            event.currentTarget.style.setProperty("--rail-pointer-x", "50%");
          }}
        >
          <span
            aria-hidden="true"
            className={cn(
              "h-0.5 w-3 rounded-full transition-[background-color,transform,filter] duration-150",
              "translate-x-[calc(var(--rail-energy)*0.25rem)]",
              "origin-left scale-x-[calc(1_+_var(--rail-energy)*1.75)]",
              visible ? "bg-foreground/70" : "bg-muted-foreground/35",
              "group-focus-visible/mark:bg-foreground group-focus-visible/mark:ring-2 group-focus-visible/mark:ring-ring/35",
              "motion-reduce:translate-x-0 motion-reduce:scale-x-100 motion-reduce:transition-none",
            )}
          >
            <span
              className="block size-full rounded-full opacity-[var(--rail-energy)]"
              style={{
                backgroundImage:
                  "radial-gradient(ellipse at var(--rail-pointer-x) 50%, color-mix(in oklab, var(--foreground) 88%, transparent), transparent 72%)",
                filter:
                  "drop-shadow(0 0 4px color-mix(in oklab, var(--foreground) 20%, transparent))",
              }}
            />
          </span>
        </button>
      </HoverCardTrigger>
      <HoverCardContent
        side="right"
        align="center"
        sideOffset={12}
        className="w-80 space-y-3"
      >
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">面试官</p>
          <p className="line-clamp-3 text-sm leading-6">{preview.question}</p>
        </div>
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">你的回答</p>
          <p className="line-clamp-4 text-sm leading-6 text-muted-foreground">
            {preview.answer}
          </p>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
