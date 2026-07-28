# Report Answer Preview Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide each question card’s one-line answer preview while that card is expanded, in both authenticated and shared reports.

**Architecture:** Use the existing Radix accordion item `data-state` as the only state source. Add a Tailwind group to each item and an open-state group variant to the preview, avoiding new React state or effects.

**Tech Stack:** React 19, Next.js 16 App Router, Radix accordion, Tailwind CSS v4, TypeScript

## Global Constraints

- Apply the interaction to both the authenticated report and public shared report.
- Preserve report data, scoring, filtering, navigation, and accordion behavior.
- Collapsed cards show the existing one-line preview; expanded cards show only the complete answer section.
- Do not add dependencies or duplicate accordion state in React.

---

### Task 1: Synchronize answer-preview visibility with accordion state

**Files:**
- Modify: `app/(app)/interviews/[interviewId]/report/page.tsx:820-850`
- Modify: `app/share/interviews/[interviewId]/page.tsx:333-362`

**Interfaces:**
- Consumes: Radix `AccordionItem`’s `data-state="open" | "closed"` attribute and Tailwind’s group-data variant.
- Produces: A collapsed-only answer preview in both report surfaces; no new exported interface.

- [ ] **Step 1: Verify the visibility rule is not implemented yet**

Run:

```bash
test "$(rg -l 'group-data-\\[state=open\\]:hidden' \
  'app/(app)/interviews/[interviewId]/report/page.tsx' \
  'app/share/interviews/[interviewId]/page.tsx' | wc -l | tr -d ' ')" = "2"
```

Expected: FAIL with exit code 1 because neither report page currently applies the open-state hiding class.

- [ ] **Step 2: Add the accordion-state styles to both report pages**

In each report page, add `group` to the question `AccordionItem` and add `group-data-[state=open]:hidden` to the one-line answer preview:

```tsx
<AccordionItem
  key={question.id}
  value={question.id}
  className="group border rounded-xl bg-card shadow-sm overflow-hidden"
>
  {/* trigger heading and question */}
  {question.answerText && (
    <p className="text-sm text-muted-foreground line-clamp-1 group-data-[state=open]:hidden">
      {question.answerText}
    </p>
  )}
</AccordionItem>
```

Use the local variable already present in each file (`q` in the authenticated report and `question` in the shared report); do not restructure the surrounding accordion.

- [ ] **Step 3: Verify both surfaces contain the rule**

Run:

```bash
test "$(rg -l 'group-data-\\[state=open\\]:hidden' \
  'app/(app)/interviews/[interviewId]/report/page.tsx' \
  'app/share/interviews/[interviewId]/page.tsx' | wc -l | tr -d ' ')" = "2"
```

Expected: PASS with exit code 0.

- [ ] **Step 4: Run static validation**

Run:

```bash
npx tsc --noEmit
pnpm lint -- \
  'app/(app)/interviews/[interviewId]/report/page.tsx' \
  'app/share/interviews/[interviewId]/page.tsx'
```

Expected: Both commands exit with code 0 and report no TypeScript or ESLint errors in the affected pages.

- [ ] **Step 5: Inspect the final diff**

Run:

```bash
git diff --check
git diff -- \
  'app/(app)/interviews/[interviewId]/report/page.tsx' \
  'app/share/interviews/[interviewId]/page.tsx'
```

Expected: No whitespace errors. The diff only adds the `group` and `group-data-[state=open]:hidden` classes in both report pages.

- [ ] **Step 6: Commit the implementation**

```bash
git add -- \
  'app/(app)/interviews/[interviewId]/report/page.tsx' \
  'app/share/interviews/[interviewId]/page.tsx'
git commit -m "fix(report): hide answer preview when expanded"
```

Expected: One commit containing only the two report-page style changes.
