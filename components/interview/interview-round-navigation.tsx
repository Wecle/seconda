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

export function magneticEnergy(distance: number, radius: number) {
  if (radius <= 0 || distance >= radius) return 0;
  const normalized = 1 - Math.max(0, distance) / radius;
  return normalized * normalized * (3 - 2 * normalized);
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
  const visibleMessageIdsRef = useRef(new Set<string>());
  const [visibleIds, setVisibleIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  useEffect(() => {
    const root = scrollRootRef.current;
    if (!root || groups.length === 0) return;

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
        if (entry.isIntersecting) visibleMessageIdsRef.current.add(messageId);
        else visibleMessageIdsRef.current.delete(messageId);
      }
      setVisibleIds(visibleGroupIds(groups, visibleMessageIdsRef.current));
    }, { root, threshold: 0 });

    for (const element of elements) observer.observe(element);
    return () => {
      observer.disconnect();
      visibleMessageIdsRef.current.clear();
    };
  }, [getMessageElement, groups, scrollRootRef]);

  if (groups.length === 0) return null;

  const resetMarks = () => {
    const marks = railRef.current?.querySelectorAll<HTMLElement>(
      "[data-round-navigation-mark]",
    );
    marks?.forEach((mark) => {
      mark.style.setProperty("--rail-energy", "0");
      mark.style.setProperty("--rail-pointer-x", "50%");
    });
  };

  const handlePointerMove = (event: PointerEvent<HTMLElement>) => {
    const marks = railRef.current?.querySelectorAll<HTMLElement>(
      "[data-round-navigation-mark]",
    );
    marks?.forEach((mark) => {
      const rect = mark.getBoundingClientRect();
      const distance = Math.abs(event.clientY - (rect.top + rect.height / 2));
      const energy = magneticEnergy(distance, magneticRadius);
      const pointerPercentage = rect.width === 0
        ? 50
        : Math.min(
          100,
          Math.max(0, ((event.clientX - rect.left) / rect.width) * 100),
        );
      mark.style.setProperty("--rail-energy", energy.toFixed(4));
      mark.style.setProperty("--rail-pointer-x", `${pointerPercentage}%`);
    });
  };

  const navigate = (group: InterviewQuestionAnswerGroup) => {
    const element = getMessageElement(group.question.id);
    if (!element) return;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    element.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "center",
    });
  };

  return (
    <nav
      ref={railRef}
      aria-label="面试问答导航"
      className="absolute -left-16 top-1/2 z-20 hidden -translate-y-1/2 flex-col py-2 xl:flex"
      onPointerMove={handlePointerMove}
      onPointerLeave={resetMarks}
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

function RoundNavigationMark({
  group,
  visible,
  onNavigate,
}: {
  group: InterviewQuestionAnswerGroup;
  visible: boolean;
  onNavigate: () => void;
}) {
  const [open, setOpen] = useState(false);
  const style: RailMarkStyle = {
    "--rail-energy": 0,
    "--rail-pointer-x": "50%",
  };

  return (
    <HoverCard open={open} onOpenChange={setOpen} openDelay={120} closeDelay={80}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          data-round-navigation-mark
          data-resting-width="equal"
          aria-label={`查看并定位：${group.question.content.slice(0, 80)}`}
          className="group/mark relative flex h-5 w-12 items-center"
          style={style}
          onClick={onNavigate}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
        >
          <span
            aria-hidden="true"
            className={cn(
              "h-0.5 w-3 rounded-full transition-[background-color,transform,filter] duration-150",
              "translate-x-[calc(var(--rail-energy)*0.25rem)]",
              "origin-left scale-x-[calc(1_+_var(--rail-energy)*1.75)]",
              visible ? "bg-foreground/70" : "bg-muted-foreground/35",
              "motion-reduce:translate-x-0 motion-reduce:scale-x-100",
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
          <p className="line-clamp-3 text-sm leading-6">{group.question.content}</p>
        </div>
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">你的回答</p>
          <p className="line-clamp-4 text-sm leading-6 text-muted-foreground">
            {group.answer?.content ?? "等待回答"}
          </p>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
