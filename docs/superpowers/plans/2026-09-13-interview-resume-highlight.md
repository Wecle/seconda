# 面试室简历查看与事实动态高亮实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 AI 模拟面试室中实现当前版本简历查看面板（可左右拖拽调宽的双列分栏，默认收起），并根据当前问题（含追问事实继承机制）及历史问题对简历事实进行双层颜色（常驻已考察 vs 当前激活态）高亮与自动平滑对齐。

**Architecture:** 
1. 投影层与 API 层：在 `lib/interview/projections/` 中向客户端暴露 `resumeEvidenceIds`，并新增 `GET /api/interviews/[id]/resume` 端点按需拉取固化快照与 PDF 文件信息；
2. 逻辑与状态层：通过 `useInterviewResumeHighlight` 聚合全场已考察事实（常驻）并针对当前聚焦问题推导激活态事实（追问无事实时自动向上回溯继承主问题事实）；
3. 界面交互层：通过 `useResizableColumns` 支持双列布局自由拖拽与最小宽度限制，在右侧 `InterviewResumePane` 中提供结构化简历（精准路径高亮与自动对齐）和 PDF 原件标签页切换。

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript (strict), TailwindCSS v4, shadcn/ui, Drizzle ORM, Lucide React, react-pdf.

## Global Constraints
- Language: TypeScript (strict), React 19, Next.js 16 App Router
- Styling: TailwindCSS v4 + shadcn/ui
- AI prompts: Chinese system prompts
- No code comments unless complex logic
- Minimum column widths: Left column (QA) `min-w-[420px]`, Right column (Resume) `min-w-[380px]`
- Default collapsed, two-column split when expanded on `>= lg`, mobile fallback

---

### Task 1: 题目投影层暴露 `resumeEvidenceIds`

**Files:**
- Modify: `lib/interview/projections/types.ts`
- Modify: `lib/interview/projections/room.ts`
- Modify: `lib/interview/projections/transcript.ts`
- Test: `lib/interview/projections/transcript.test.ts` (or `lib/interview/projections/evidence-projection.test.ts`)

**Interfaces:**
- Consumes: `questionCommittedSchema` payload from `agentEvents`
- Produces: `InterviewQuestionView.resumeEvidenceIds: string[]`, `InterviewTranscriptItem & { type: "question" }.resumeEvidenceIds: string[]`

- [ ] **Step 1: 编写测试用例验证投影暴露 `resumeEvidenceIds`**

创建 `lib/interview/projections/evidence-projection.test.ts`：
```ts
import test from "node:test";
import assert from "node:assert/strict";
import { projectInterviewTranscript } from "./transcript";
import { projectInterviewRoom } from "./room";

test("transcript projection includes resumeEvidenceIds for question items", () => {
  const events = [
    {
      runId: "b8f526b7-8ce6-42d4-a130-9b4f2c96c421",
      sequence: 1,
      type: "interview/question_committed",
      schemaVersion: 1,
      visibility: "user" as const,
      payload: {
        interviewId: "018f4fd4-7e9b-7359-99ff-4aa651b14a90",
        questionId: "3df1db8c-02cf-4b68-b7fb-586bce50ad66",
        sequence: 1,
        kind: "main" as const,
        topic: "React 性能优化",
        question: "请介绍你在项目中是如何做 React 性能优化的？",
        tip: null,
        resumeEvidenceIds: ["ev_1234567890abcdef", "ev_abcdef1234567890"],
      },
    },
  ];

  const transcript = projectInterviewTranscript({ events });
  assert.equal(transcript.length, 1);
  assert.equal(transcript[0].type, "question");
  if (transcript[0].type === "question") {
    assert.deepEqual(transcript[0].resumeEvidenceIds, ["ev_1234567890abcdef", "ev_abcdef1234567890"]);
  }
});

test("room projection includes resumeEvidenceIds on currentQuestion", () => {
  const room = projectInterviewRoom({
    interview: {
      id: "018f4fd4-7e9b-7359-99ff-4aa651b14a90",
      agentSessionId: "018f4fd4-7e9b-7359-99ff-4aa651b14a91",
      status: "active",
      answeredRoundCount: 0,
      targetRoundCount: 5,
    },
    currentQuestion: {
      id: "3df1db8c-02cf-4b68-b7fb-586bce50ad66",
      sequence: 1,
      kind: "main",
      topic: "React 性能优化",
      question: "请介绍你在项目中是如何做 React 性能优化的？",
      tip: null,
      status: "awaiting_answer",
      resumeEvidenceIds: ["ev_1234567890abcdef"],
    },
    currentRun: null,
    completionJob: null,
  });

  assert.equal(room.currentQuestion?.id, "3df1db8c-02cf-4b68-b7fb-586bce50ad66");
  assert.deepEqual(room.currentQuestion?.resumeEvidenceIds, ["ev_1234567890abcdef"]);
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npx tsx --test lib/interview/projections/evidence-projection.test.ts`
Expected: FAIL（属性不存在或未定义）

- [ ] **Step 3: 更新投影定义与实现**

在 `lib/interview/projections/types.ts`：
```ts
export interface InterviewQuestionView {
  id: string;
  sequence: number;
  kind: "main" | "follow_up";
  topic: string;
  content: string;
  tip: string | null;
  resumeEvidenceIds: string[];
}

export interface InterviewQuestionSnapshot {
  id: string;
  sequence: number;
  kind: "main" | "follow_up";
  topic: string;
  question: string;
  tip: string | null;
  status: "awaiting_answer" | "answered" | "skipped" | "abandoned";
  resumeEvidenceIds?: string[];
}

// 在 InterviewTranscriptItem 中:
  | {
      type: "question";
      questionId: string;
      sequence: number;
      kind: "main" | "follow_up";
      content: string;
      resumeEvidenceIds: string[];
    }
```

在 `lib/interview/projections/room.ts`：
```ts
    currentQuestion: input.currentQuestion
      ? {
          id: input.currentQuestion.id,
          sequence: input.currentQuestion.sequence,
          kind: input.currentQuestion.kind,
          topic: input.currentQuestion.topic,
          content: input.currentQuestion.question,
          tip: input.currentQuestion.tip,
          resumeEvidenceIds: input.currentQuestion.resumeEvidenceIds ?? [],
        }
      : null,
```

在 `lib/interview/projections/transcript.ts`：
```ts
      case "interview/question_committed": {
        const payload = questionCommittedSchema.parse(event.payload);
        transcript.push({
          type: "question",
          questionId: payload.questionId,
          sequence: payload.sequence,
          kind: payload.kind,
          content: payload.question,
          resumeEvidenceIds: payload.resumeEvidenceIds,
        });
        break;
      }
```

在 `lib/interview/persistence/repository.ts` 的 `loadOwnedInterviewRoomData` 中：
```ts
    const questions = await transaction.select({
      id: interviewQuestions.id,
      sequence: interviewQuestions.sequence,
      kind: interviewQuestions.kind,
      topic: interviewQuestions.topic,
      question: interviewQuestions.question,
      tip: interviewQuestions.tip,
      status: interviewQuestions.status,
      resumeEvidenceIds: interviewQuestions.resumeEvidenceIds,
    }).from(interviewQuestions).where(and(
      eq(interviewQuestions.interviewId, interview.id),
      eq(interviewQuestions.status, "awaiting_answer"),
    )).limit(1);
```

在 `lib/interview/application/get-interview-room.ts` 的 `questionSchema` 中：
```ts
const questionSchema = z.object({
  id: z.string().uuid(),
  sequence: z.number().int().positive(),
  kind: z.enum(["main", "follow_up"]),
  topic: z.string(),
  question: z.string(),
  tip: z.string().nullable(),
  status: z.enum(["awaiting_answer", "answered", "skipped", "abandoned"]),
  resumeEvidenceIds: z.array(z.string()).optional(),
});
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npx tsx --test lib/interview/projections/evidence-projection.test.ts`
Expected: PASS

- [ ] **Step 5: 提交改动**

```bash
git add lib/interview/projections/ lib/interview/persistence/repository.ts lib/interview/application/get-interview-room.ts
git commit -m "feat(interview): expose resumeEvidenceIds on question projection and transcript"
```

---

### Task 2: 独立简历快照接口 `GET /api/interviews/[id]/resume`

**Files:**
- Create: `app/api/interviews/[id]/resume/route.ts`
- Modify: `lib/interview/persistence/repository.ts`
- Test: `lib/interview/interview-resume-api.integration.test.ts`

**Interfaces:**
- Consumes: `userId: string`, `interviewId: string`
- Produces: `InterviewResumeSnapshotResponse` JSON

- [ ] **Step 1: 编写持久化层加载快照的方法测试用例**

创建 `lib/interview/interview-resume-api.integration.test.ts`：
```ts
import test from "node:test";
import assert from "node:assert/strict";
import { loadOwnedInterviewResumeSnapshot } from "./persistence/repository";
import { db } from "@/lib/db";

test("loadOwnedInterviewResumeSnapshot returns null for non-existent interview", async () => {
  const result = await loadOwnedInterviewResumeSnapshot({
    database: db,
    userId: "00000000-0000-0000-0000-000000000000",
    interviewId: "00000000-0000-0000-0000-000000000000",
  });
  assert.equal(result, null);
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npx tsx --test lib/interview/interview-resume-api.integration.test.ts`
Expected: FAIL（`loadOwnedInterviewResumeSnapshot` 未导出）

- [ ] **Step 3: 在 repository.ts 中实现 `loadOwnedInterviewResumeSnapshot`**

在 `lib/interview/persistence/repository.ts` 导出函数：
```ts
export async function loadOwnedInterviewResumeSnapshot(input: {
  database: InterviewDatabase;
  userId: string;
  interviewId: string;
}) {
  const [snapshot] = await input.database
    .select({
      interviewId: interviewResumeSnapshots.interviewId,
      resumeId: interviewResumeSnapshots.resumeId,
      resumeVersionId: interviewResumeSnapshots.resumeVersionId,
      resumeTitle: interviewResumeSnapshots.resumeTitle,
      versionNumber: interviewResumeSnapshots.versionNumber,
      sourceType: interviewResumeSnapshots.sourceType,
      parsedJson: interviewResumeSnapshots.parsedJson,
      evidenceJson: interviewResumeSnapshots.evidenceJson,
      originalFilename: resumeVersions.originalFilename,
      storedPath: resumeVersions.storedPath,
    })
    .from(interviewResumeSnapshots)
    .innerJoin(interviews, eq(interviewResumeSnapshots.interviewId, interviews.id))
    .leftJoin(resumeVersions, eq(interviewResumeSnapshots.resumeVersionId, resumeVersions.id))
    .where(
      and(
        eq(interviewResumeSnapshots.interviewId, input.interviewId),
        eq(interviews.userId, input.userId),
      ),
    )
    .limit(1);

  if (!snapshot) return null;

  return {
    interviewId: snapshot.interviewId,
    resumeId: snapshot.resumeId,
    resumeVersionId: snapshot.resumeVersionId,
    resumeTitle: snapshot.resumeTitle,
    versionNumber: snapshot.versionNumber,
    sourceType: snapshot.sourceType,
    parsedJson: snapshot.parsedJson,
    evidenceJson: snapshot.evidenceJson,
    originalFilename: snapshot.originalFilename ?? null,
    originalFileUrl: snapshot.storedPath ?? null,
  };
}
```

- [ ] **Step 4: 实现 API 路由 `app/api/interviews/[id]/resume/route.ts`**

创建 `app/api/interviews/[id]/resume/route.ts`：
```ts
import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth/session";
import { loadOwnedInterviewResumeSnapshot } from "@/lib/interview/persistence/repository";
import { db } from "@/lib/db";

const interviewIdSchema = z.string().uuid();

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsedId = interviewIdSchema.safeParse((await params).id);
  if (!parsedId.success) {
    return NextResponse.json({ error: "Interview not found" }, { status: 404 });
  }

  try {
    const data = await loadOwnedInterviewResumeSnapshot({
      database: db,
      userId,
      interviewId: parsedId.data,
    });

    if (!data) {
      return NextResponse.json({ error: "Resume snapshot not found" }, { status: 404 });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Failed to load interview resume snapshot", error);
    return NextResponse.json({ error: "Failed to load resume snapshot" }, { status: 500 });
  }
}
```

- [ ] **Step 5: 运行集成测试验证通过**

Run: `npx tsx --test lib/interview/interview-resume-api.integration.test.ts`
Expected: PASS

- [ ] **Step 6: 提交代码**

```bash
git add app/api/interviews/[id]/resume/ lib/interview/persistence/repository.ts lib/interview/interview-resume-api.integration.test.ts
git commit -m "feat(interview): add GET /api/interviews/[id]/resume endpoint"
```

---

### Task 3: 高亮推导与追问继承 Hook (`useInterviewResumeHighlight`)

**Files:**
- Create: `components/interview/hooks/use-interview-resume-highlight.ts`
- Test: `components/interview/hooks/use-interview-resume-highlight.test.ts`

**Interfaces:**
- Consumes:
  - `transcript: InterviewTranscriptItem[]`
  - `currentQuestion: InterviewQuestionView | null`
  - `focusedQuestionId: string | null`
  - `evidenceJson: Record<string, { path: string; text: string }> | null`
- Produces:
  - `persistentEvidenceIds: Set<string>`
  - `activeEvidenceIds: Set<string>`
  - `isInheritedFromParent: boolean`
  - `activeEvidencePaths: Set<string>`
  - `persistentEvidencePaths: Set<string>`

- [ ] **Step 1: 编写测试用例验证常驻集、当前激活态与追问自动继承逻辑**

创建 `components/interview/hooks/use-interview-resume-highlight.test.ts`：
```ts
import test from "node:test";
import assert from "node:assert/strict";
import { computeHighlightState } from "./use-interview-resume-highlight";
import type { InterviewTranscriptItem, InterviewQuestionView } from "@/lib/interview/projections/types";

test("computeHighlightState aggregates all persistentEvidenceIds from transcript and current question", () => {
  const transcript: InterviewTranscriptItem[] = [
    {
      type: "question",
      questionId: "q1",
      sequence: 1,
      kind: "main",
      content: "Q1",
      resumeEvidenceIds: ["ev_1", "ev_2"],
    },
    {
      type: "answer",
      answerId: "a1",
      questionId: "q1",
      sequence: 2,
      content: "A1",
      skipped: false,
    },
    {
      type: "question",
      questionId: "q2",
      sequence: 3,
      kind: "main",
      content: "Q2",
      resumeEvidenceIds: ["ev_3"],
    },
  ];

  const currentQuestion: InterviewQuestionView = {
    id: "q3",
    sequence: 4,
    kind: "main",
    topic: "Topic",
    content: "Q3",
    tip: null,
    resumeEvidenceIds: ["ev_4"],
  };

  const evidenceJson = {
    ev_1: { path: "skills[0]", text: "TypeScript" },
    ev_2: { path: "experience[0].title", text: "Senior Engineer" },
    ev_3: { path: "education[0].school", text: "MIT" },
    ev_4: { path: "projects[0].name", text: "Seconda" },
  };

  const result = computeHighlightState({
    transcript,
    currentQuestion,
    focusedQuestionId: null,
    evidenceJson,
  });

  assert.deepEqual(Array.from(result.persistentEvidenceIds).sort(), ["ev_1", "ev_2", "ev_3", "ev_4"]);
  assert.deepEqual(Array.from(result.activeEvidenceIds), ["ev_4"]);
  assert.equal(result.isInheritedFromParent, false);
  assert.ok(result.activeEvidencePaths.has("projects[0].name"));
});

test("computeHighlightState inherits evidence from parent main question when follow_up has empty evidence", () => {
  const transcript: InterviewTranscriptItem[] = [
    {
      type: "question",
      questionId: "q1",
      sequence: 1,
      kind: "main",
      content: "Tell me about project X",
      resumeEvidenceIds: ["ev_proj_x"],
    },
    {
      type: "answer",
      answerId: "a1",
      questionId: "q1",
      sequence: 2,
      content: "I did Y on project X",
      skipped: false,
    },
  ];

  const currentQuestion: InterviewQuestionView = {
    id: "q2",
    sequence: 3,
    kind: "follow_up",
    topic: "Follow up on project X",
    content: "Why did you choose Y?",
    tip: null,
    resumeEvidenceIds: [], // Empty follow-up evidence
  };

  const evidenceJson = {
    ev_proj_x: { path: "projects[0].description", text: "Project X" },
  };

  const result = computeHighlightState({
    transcript,
    currentQuestion,
    focusedQuestionId: null,
    evidenceJson,
  });

  assert.deepEqual(Array.from(result.activeEvidenceIds), ["ev_proj_x"]);
  assert.equal(result.isInheritedFromParent, true);
  assert.ok(result.activeEvidencePaths.has("projects[0].description"));
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npx tsx --test components/interview/hooks/use-interview-resume-highlight.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `use-interview-resume-highlight.ts`**

创建 `components/interview/hooks/use-interview-resume-highlight.ts`：
```ts
import { useMemo } from "react";
import type { InterviewTranscriptItem, InterviewQuestionView } from "@/lib/interview/projections/types";

export interface ComputeHighlightInput {
  transcript: InterviewTranscriptItem[];
  currentQuestion: InterviewQuestionView | null;
  focusedQuestionId: string | null;
  evidenceJson: Record<string, { path: string; text: string }> | null | undefined;
}

export interface HighlightState {
  persistentEvidenceIds: Set<string>;
  activeEvidenceIds: Set<string>;
  isInheritedFromParent: boolean;
  activeEvidencePaths: Set<string>;
  persistentEvidencePaths: Set<string>;
}

export function computeHighlightState(input: ComputeHighlightInput): HighlightState {
  const { transcript, currentQuestion, focusedQuestionId, evidenceJson } = input;

  const persistentEvidenceIds = new Set<string>();

  const questionsInTranscript = transcript.filter(
    (item): item is Extract<typeof item, { type: "question" }> => item.type === "question",
  );

  for (const q of questionsInTranscript) {
    if (Array.isArray(q.resumeEvidenceIds)) {
      for (const id of q.resumeEvidenceIds) {
        if (id) persistentEvidenceIds.add(id);
      }
    }
  }

  if (currentQuestion && Array.isArray(currentQuestion.resumeEvidenceIds)) {
    for (const id of currentQuestion.resumeEvidenceIds) {
      if (id) persistentEvidenceIds.add(id);
    }
  }

  let activeTarget: {
    id: string;
    kind: "main" | "follow_up";
    resumeEvidenceIds: string[];
    sequence?: number;
  } | null = null;

  if (focusedQuestionId) {
    if (currentQuestion && currentQuestion.id === focusedQuestionId) {
      activeTarget = currentQuestion;
    } else {
      const match = questionsInTranscript.find((q) => q.questionId === focusedQuestionId);
      if (match) {
        activeTarget = {
          id: match.questionId,
          kind: match.kind,
          resumeEvidenceIds: match.resumeEvidenceIds ?? [],
          sequence: match.sequence,
        };
      }
    }
  }

  if (!activeTarget) {
    activeTarget = currentQuestion;
  }

  const activeEvidenceIds = new Set<string>();
  let isInheritedFromParent = false;

  if (activeTarget) {
    if (activeTarget.resumeEvidenceIds && activeTarget.resumeEvidenceIds.length > 0) {
      for (const id of activeTarget.resumeEvidenceIds) {
        activeEvidenceIds.add(id);
      }
    } else if (activeTarget.kind === "follow_up") {
      const targetSeq = activeTarget.sequence ?? Infinity;
      const priorQuestions = questionsInTranscript.filter((q) => q.sequence < targetSeq);
      for (let i = priorQuestions.length - 1; i >= 0; i--) {
        const candidate = priorQuestions[i];
        if (candidate.kind === "main") {
          if (candidate.resumeEvidenceIds && candidate.resumeEvidenceIds.length > 0) {
            for (const id of candidate.resumeEvidenceIds) {
              activeEvidenceIds.add(id);
            }
            isInheritedFromParent = true;
          }
          break;
        }
      }
    }
  }

  const activeEvidencePaths = new Set<string>();
  const persistentEvidencePaths = new Set<string>();

  if (evidenceJson) {
    for (const id of activeEvidenceIds) {
      const entry = evidenceJson[id];
      if (entry?.path) activeEvidencePaths.add(entry.path);
    }
    for (const id of persistentEvidenceIds) {
      const entry = evidenceJson[id];
      if (entry?.path) persistentEvidencePaths.add(entry.path);
    }
  }

  return {
    persistentEvidenceIds,
    activeEvidenceIds,
    isInheritedFromParent,
    activeEvidencePaths,
    persistentEvidencePaths,
  };
}

export function useInterviewResumeHighlight(input: ComputeHighlightInput): HighlightState {
  return useMemo(() => computeHighlightState(input), [
    input.transcript,
    input.currentQuestion,
    input.focusedQuestionId,
    input.evidenceJson,
  ]);
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npx tsx --test components/interview/hooks/use-interview-resume-highlight.test.ts`
Expected: PASS

- [ ] **Step 5: 提交代码**

```bash
git add components/interview/hooks/
git commit -m "feat(interview): implement useInterviewResumeHighlight hook with follow-up inheritance"
```

---

### Task 4: 双列拖拽宽度调节 Hook (`useResizableColumns`)

**Files:**
- Create: `components/interview/hooks/use-resizable-columns.ts`
- Test: `components/interview/hooks/use-resizable-columns.test.ts`

**Interfaces:**
- Consumes: `containerRef`, `minLeft: number`, `minRight: number`, `defaultRatio: number`
- Produces: `leftRatio: number`, `isDragging: boolean`, `handleMouseDown`, `resetRatio`

- [ ] **Step 1: 编写边界与计算逻辑测试**

创建 `components/interview/hooks/use-resizable-columns.test.ts`：
```ts
import test from "node:test";
import assert from "node:assert/strict";
import { clampRatio } from "./use-resizable-columns";

test("clampRatio respects minLeft and minRight bounds", () => {
  const containerWidth = 1000;
  const minLeft = 420;
  const minRight = 380;

  assert.equal(clampRatio(0.5, containerWidth, minLeft, minRight), 0.5);
  assert.equal(clampRatio(0.2, containerWidth, minLeft, minRight), 0.42);
  assert.equal(clampRatio(0.9, containerWidth, minLeft, minRight), 0.62);
});

test("clampRatio falls back safely when container is narrower than total minWidth", () => {
  const containerWidth = 700;
  const minLeft = 420;
  const minRight = 380;

  const result = clampRatio(0.5, containerWidth, minLeft, minRight);
  assert.ok(result >= 0.3 && result <= 0.7);
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `npx tsx --test components/interview/hooks/use-resizable-columns.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `use-resizable-columns.ts`**

创建 `components/interview/hooks/use-resizable-columns.ts`：
```ts
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
```

- [ ] **Step 4: 运行测试验证通过**

Run: `npx tsx --test components/interview/hooks/use-resizable-columns.test.ts`
Expected: PASS

- [ ] **Step 5: 提交代码**

```bash
git add components/interview/hooks/
git commit -m "feat(interview): add useResizableColumns hook with min-width constraints"
```

---

### Task 5: 结构化简历视图双色高亮组件 (`InterviewParsedResumeView`)

**Files:**
- Create: `components/interview/interview-parsed-resume-view.tsx`
- Test: Manual / Component rendering check

**Interfaces:**
- Consumes:
  - `parsed: ParsedResume`
  - `activePaths: Set<string>`
  - `persistentPaths: Set<string>`
  - `scrollContainerRef: React.RefObject<HTMLElement | null>`
- Produces: Rendered resume with active amber glow & persistent blue highlights, and auto-scroll behavior.

- [ ] **Step 1: 实现 `InterviewParsedResumeView`**

创建 `components/interview/interview-parsed-resume-view.tsx`：
* 遍历 `parsed` 的全部节点（`summary`, `skills[i]`, `experience[i].bullets[j]`, `education[i]`, `projects[i]`）；
* 精准比对 `path`：
  - 若属于 `activePaths`：应用鲜艳琥珀金样式（`bg-amber-400/20 text-foreground ring-1.5 ring-amber-500/80 shadow-2xs font-medium rounded-md px-1.5 py-0.5 animate-in fade-in`）并加上 `data-active-fact="true"`；
  - 若属于 `persistentPaths`：应用柔和灰蓝样式（`bg-primary/8 text-foreground ring-1 ring-primary/20 rounded-md px-1 py-0.5`）；
  - 否则正常展示；
* 挂载 `useLayoutEffect`：当 `activePaths` 产生新项时，查找带有 `data-active-fact="true"` 的首个 DOM 元素并平滑居中滚动：
  ```ts
  const firstActive = containerRef.current?.querySelector('[data-active-fact="true"]');
  if (firstActive) {
    firstActive.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  ```

- [ ] **Step 2: 验证编译无报错**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: 提交代码**

```bash
git add components/interview/interview-parsed-resume-view.tsx
git commit -m "feat(interview): create InterviewParsedResumeView with dual-color fact highlights"
```

---

### Task 6: 右侧简历面板组件 (`InterviewResumePane`)

**Files:**
- Create: `components/interview/interview-resume-pane.tsx`
- Test: Component compilation & integration

**Interfaces:**
- Consumes:
  - `interviewId: string`
  - `isOpen: boolean`
  - `onClose: () => void`
  - `activeEvidencePaths: Set<string>`
  - `persistentEvidencePaths: Set<string>`
  - `activeCount: number`
  - `isInherited: boolean`
- Produces: Complete right-hand pane with Toolbar, Segmented Switcher, and Scrollable Body.

- [ ] **Step 1: 实现 `InterviewResumePane`**

创建 `components/interview/interview-resume-pane.tsx`：
* 首次加载或打开时向 `/api/interviews/${interviewId}/resume` 发起请求；
* 支持「结构化视图」和「PDF 原件」Tab 切换（若 `sourceType === "uploaded"` 且 `originalFileUrl` 存在）；
* 顶部 Toolbar：
  * 显示 `resumeTitle` 与 `v{versionNumber}`；
  * 若 `activeCount > 0`，显示带有琥珀色圆点的徽章（`当前关联 X 处事实`，若是继承则显示 `继承自上一问`）；
  * 提供「定位高亮」快捷点击按钮；
  * 提供「收起」按钮触发 `onClose`；
* 内部加载状态使用 Skeleton / Spinner；若加载失败提供重试按钮。

- [ ] **Step 2: 验证类型检查无报错**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: 提交代码**

```bash
git add components/interview/interview-resume-pane.tsx
git commit -m "feat(interview): create InterviewResumePane component"
```

---

### Task 7: 面试室主体集成两列分栏与问答联动

**Files:**
- Modify: `components/interview/interview-room.tsx`

- [ ] **Step 1: 在 `InterviewRoom` 引入分栏与高亮联动状态**

* 在 `InterviewRoom` 中维护：
  * `resumePaneOpen: boolean`（默认 `false` 收起）；
  * `focusedQuestionId: string | null`（默认 `null`，点击历史题目或钢琴键时设置）；
* 引入 `useInterviewResumeHighlight`：
  ```ts
  const highlightState = useInterviewResumeHighlight({
    transcript,
    currentQuestion: room.currentQuestion,
    focusedQuestionId,
    evidenceJson: resumeData?.evidenceJson,
  });
  ```
* 顶部导航栏增加「简历对照」按钮：
  - 点击开关 `resumePaneOpen`；
  - 徽章显示 `highlightState.activeEvidenceIds.size`；
* 容器布局改造：
  - 外层容器使用 `useResizableColumns`；
  - 展开状态下在 `>= lg` 屏幕渲染拖拽分割把手（`Draggable Divider`），两列自适应宽度；
  - `< lg` 屏幕使用 Sheet 抽屉展现；
  - 候选人在输入框打字时自动清空 `focusedQuestionId`，使高亮重置回当前题目。

- [ ] **Step 2: 运行类型检查与现有面试测试套件**

Run: `npx tsc --noEmit`
Run: `pnpm test`
Expected: PASS

- [ ] **Step 3: 提交代码**

```bash
git add components/interview/interview-room.tsx
git commit -m "feat(interview): integrate resizable two-column layout and resume highlight sync"
```

---

### Task 8: 全量测试验证与代码质量检查

- [ ] **Step 1: 运行全量单元与集成测试**
Run: `pnpm test`
Expected: ALL PASS

- [ ] **Step 2: 运行类型检查**
Run: `npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 3: 运行代码规范检查**
Run: `pnpm lint`
Expected: 0 warnings/errors

- [ ] **Step 4: 提交最终功能代码**
```bash
git commit -m "chore: complete interview resume inspection and dynamic highlighting verification"
```
