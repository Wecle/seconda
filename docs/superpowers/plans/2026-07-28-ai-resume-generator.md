# AI Resume Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a truth-preserving AI resume generator that creates editable, snapshot-compatible resume versions without original files.

**Architecture:** Treat uploaded and generated resumes as two source types in the existing Resume/ResumeVersion model. Validate and normalize generator input in a pure domain layer, use the existing structured AI gateway, persist generated Resume + v1 atomically with user-scoped idempotency, and reuse the existing parsed preview/editor/interview flow with source-aware attachment controls.

**Tech Stack:** TypeScript strict mode, React 19, Next.js 16 App Router, Tailwind CSS v4, shadcn/Radix UI, Zod 4, Vercel AI SDK, Drizzle ORM, PostgreSQL, Node test runner via `tsx --test`.

## Global Constraints

- AI may organize, rewrite, and summarize only user-provided facts; it must never invent experience.
- Optional blank inputs remain empty.
- Generator fields are exactly name, target role, core skills, education, work experience, and additional information.
- Name and target role are limited to 100 characters.
- Raw core skills are limited to 1,000 characters, 50 normalized skills, and 100 characters per skill.
- Education is limited to 3,000 characters; work experience and additional information are each limited to 5,000 characters.
- Generated output follows the current `zh` or `en` interface locale.
- Generation always creates an independent Resume v1.
- Generated versions and snapshots have null attachment fields and default to parsed content.
- Existing upload, edit, snapshot, interview, scoring, and report behavior must not regress.
- Do not add resume document export, templates, or visual layout selection.

---

## File map

- `lib/resume/generation-contract.ts`: generator request validation, skill normalization, draft/request types.
- `lib/resume/canonical-text.ts`: deterministic `ParsedResume` to interview-grounding text serialization.
- `lib/resume/generate-resume.ts`: truth-constrained structured AI prompt and deterministic output overlay.
- `lib/resume/generated-resume-store.ts`: idempotent atomic Resume + generated v1 persistence.
- `app/api/resumes/generate/route.ts`: authenticated API orchestration and safe errors.
- `components/dashboard/upload-resume-form.tsx`: existing upload-tab body extracted from the current dialog.
- `components/dashboard/generated-resume-form.tsx`: six-field generator form and quick choices.
- `components/dashboard/new-resume-dialog.tsx`: animated two-tab dialog shell.
- Existing schema, migration, snapshot, dashboard, list/edit API, interview API, and resume-sheet files receive narrowly scoped source-type changes.

### Task 1: Generator input contract and canonical text

**Files:**
- Create: `lib/resume/generation-contract.ts`
- Create: `lib/resume/generation-contract.test.ts`
- Create: `lib/resume/canonical-text.ts`
- Create: `lib/resume/canonical-text.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `GeneratedResumeDraft`, `GeneratedResumeInput`, `generatedResumeRequestSchema`, `normalizeSkills(raw: string): string[]`.
- Produces: `serializeParsedResume(parsed: ParsedResume): string`.

- [ ] **Step 1: Add failing contract tests**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  generatedResumeRequestSchema,
  normalizeSkills,
} from "./generation-contract";

test("normalizes separators, whitespace and duplicate skills", () => {
  assert.deepEqual(
    normalizeSkills(" React，TypeScript\nReact, Node.js "),
    ["React", "TypeScript", "Node.js"],
  );
});

test("accepts the smallest factual request and keeps optionals blank", () => {
  const parsed = generatedResumeRequestSchema.parse({
    idempotencyKey: "8ca42076-f973-4510-b387-f797115bf786",
    locale: "zh",
    name: "",
    targetRole: "前端工程师",
    coreSkills: "React, TypeScript",
    education: "",
    workExperience: "",
    additionalInfo: "",
  });
  assert.deepEqual(parsed.coreSkills, ["React", "TypeScript"]);
  assert.equal(parsed.education, "");
});

test("rejects empty, excessive and overlong skills", () => {
  const base = {
    idempotencyKey: "8ca42076-f973-4510-b387-f797115bf786",
    locale: "en",
    name: "",
    targetRole: "Engineer",
    education: "",
    workExperience: "",
    additionalInfo: "",
  };
  assert.throws(() => generatedResumeRequestSchema.parse({ ...base, coreSkills: " , \n" }));
  assert.throws(() => generatedResumeRequestSchema.parse({
    ...base,
    coreSkills: Array.from({ length: 51 }, (_, index) => `skill-${index}`).join(","),
  }));
  assert.throws(() => generatedResumeRequestSchema.parse({
    ...base,
    coreSkills: "x".repeat(101),
  }));
});
```

- [ ] **Step 2: Run the contract test and verify failure**

Run: `pnpm exec tsx --test lib/resume/generation-contract.test.ts`

Expected: FAIL with `Cannot find module './generation-contract'`.

- [ ] **Step 3: Implement the generator contract**

```ts
import { z } from "zod";

export interface GeneratedResumeDraft {
  name: string;
  targetRole: string;
  coreSkills: string;
  education: string;
  workExperience: string;
  additionalInfo: string;
}

export function normalizeSkills(raw: string): string[] {
  const seen = new Set<string>();
  const skills: string[] = [];
  for (const part of raw.split(/[,，\n]/)) {
    const skill = part.trim();
    const key = skill.toLocaleLowerCase();
    if (!skill || seen.has(key)) continue;
    seen.add(key);
    skills.push(skill);
  }
  return skills;
}

const coreSkillsSchema = z.string().max(1_000)
  .transform(normalizeSkills)
  .refine((skills) => skills.length >= 1, "At least one skill is required")
  .refine((skills) => skills.length <= 50, "At most 50 skills are allowed")
  .refine((skills) => skills.every((skill) => skill.length <= 100), "Each skill must be at most 100 characters");

export const generatedResumeRequestSchema = z.object({
  idempotencyKey: z.uuid(),
  locale: z.enum(["zh", "en"]),
  name: z.string().trim().max(100).default(""),
  targetRole: z.string().trim().min(1).max(100),
  coreSkills: coreSkillsSchema,
  education: z.string().trim().max(3_000).default(""),
  workExperience: z.string().trim().max(5_000).default(""),
  additionalInfo: z.string().trim().max(5_000).default(""),
});

export type GeneratedResumeInput = z.output<typeof generatedResumeRequestSchema>;
```

- [ ] **Step 4: Add failing canonical-text tests**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { serializeParsedResume } from "./canonical-text";

test("serializes every populated resume section in stable order", () => {
  const text = serializeParsedResume({
    name: "Ada",
    title: "Engineer",
    summary: "Builds reliable systems",
    contact: { email: "ada@example.com" },
    skills: ["TypeScript"],
    experience: [{
      title: "Engineer",
      company: "Example",
      period: "2024-present",
      bullets: ["Reduced latency"],
    }],
    education: [{ degree: "BSc", school: "Example University", period: "2020-2024" }],
    projects: [{ name: "Compiler", description: "A real project", tags: ["TypeScript"] }],
  });
  assert.match(text, /Ada[\s\S]*Engineer[\s\S]*Builds reliable systems/);
  assert.match(text, /ada@example\.com/);
  assert.match(text, /Reduced latency/);
  assert.match(text, /Compiler/);
  assert.equal(text, serializeParsedResume({
    name: "Ada",
    title: "Engineer",
    summary: "Builds reliable systems",
    contact: { email: "ada@example.com" },
    skills: ["TypeScript"],
    experience: [{ title: "Engineer", company: "Example", period: "2024-present", bullets: ["Reduced latency"] }],
    education: [{ degree: "BSc", school: "Example University", period: "2020-2024" }],
    projects: [{ name: "Compiler", description: "A real project", tags: ["TypeScript"] }],
  }));
});
```

- [ ] **Step 5: Implement canonical serialization**

Implement `serializeParsedResume` with fixed section order: identity, summary, contact, skills, experience, education, projects. Append only non-empty values; include every experience bullet and project tag. Join sections with `\n\n` and list items with `\n`.

```ts
import type { ParsedResume } from "./types";

export function serializeParsedResume(parsed: ParsedResume): string {
  const sections: string[] = [];
  const identity = [parsed.name, parsed.title].filter(Boolean).join("\n");
  if (identity) sections.push(identity);
  if (parsed.summary) sections.push(`Summary\n${parsed.summary}`);

  const contact = parsed.contact
    ? Object.entries(parsed.contact)
        .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0)
        .map(([key, value]) => `${key}: ${value}`)
    : [];
  if (contact.length > 0) sections.push(`Contact\n${contact.join("\n")}`);
  if (parsed.skills.length > 0) sections.push(`Skills\n${parsed.skills.join(", ")}`);

  if (parsed.experience.length > 0) {
    sections.push(`Experience\n${parsed.experience.map((entry) => [
      [entry.title, entry.company, entry.period].filter(Boolean).join(" | "),
      ...entry.bullets.map((bullet) => `- ${bullet}`),
    ].join("\n")).join("\n\n")}`);
  }

  if ((parsed.education?.length ?? 0) > 0) {
    sections.push(`Education\n${parsed.education!.map((entry) =>
      [entry.degree, entry.major, entry.school, entry.period].filter(Boolean).join(" | "),
    ).join("\n")}`);
  }

  if ((parsed.projects?.length ?? 0) > 0) {
    sections.push(`Projects\n${parsed.projects!.map((project) => [
      project.name,
      project.description,
      ...(project.tags?.length ? [`Tags: ${project.tags.join(", ")}`] : []),
    ].filter(Boolean).join("\n")).join("\n\n")}`);
  }

  return sections.join("\n\n").trim();
}
```

- [ ] **Step 6: Include resume tests in the standard suite and run them**

Change `package.json` test script to include `lib/resume/*.test.ts`.

Run: `pnpm exec tsx --test lib/resume/generation-contract.test.ts lib/resume/canonical-text.test.ts`

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add package.json lib/resume/generation-contract.ts lib/resume/generation-contract.test.ts lib/resume/canonical-text.ts lib/resume/canonical-text.test.ts
git commit -m "feat(resume): add generator input contract"
```

### Task 2: Source-aware database and snapshot semantics

**Files:**
- Modify: `lib/db/schema.ts:26-102`
- Modify: `lib/db/migrate.ts:35-220`
- Modify: `lib/resume/types.ts`
- Modify: `lib/interview/resume-snapshot.ts`
- Modify: `lib/interview/resume-snapshot.test.ts`
- Modify: `lib/interview/agent/drizzle-store.ts:50-80`

**Interfaces:**
- Consumes: `ResumeSourceType` from `lib/resume/types.ts`.
- Produces: nullable attachment fields and `sourceType` on versions/snapshots.

- [ ] **Step 1: Extend snapshot tests first**

Add a generated snapshot case with `sourceType: "generated"` and all attachment fields null. Change deletion tests to pass `[null, "kept.pdf", "unused.pdf"]` and assert only `"unused.pdf"` is deletable.

Run: `pnpm exec tsx --test lib/interview/resume-snapshot.test.ts`

Expected: FAIL because snapshot types require strings and do not include `sourceType`.

- [ ] **Step 2: Add source types and nullable Drizzle columns**

Add to `lib/resume/types.ts`:

```ts
export type ResumeSourceType = "uploaded" | "generated";
```

In `resumes`, add nullable `creationIdempotencyKey`. Add a partial unique index on `(userId, creationIdempotencyKey)`. In `resumeVersions` and `interviewResumeSnapshots`, add `sourceType` as non-null text defaulting to `"uploaded"` and typed as `ResumeSourceType`; remove `.notNull()` from `originalFilename` and `storedPath`. Add database checks that source type is one of the two values and that generated rows have null filename, path, MIME, and size.

- [ ] **Step 3: Add rerunnable SQL migration**

Before snapshot backfill, add exact migration operations for:

```sql
ALTER TABLE resumes ADD COLUMN IF NOT EXISTS creation_idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_resumes_creation_owner_key
  ON resumes(user_id, creation_idempotency_key)
  WHERE user_id IS NOT NULL AND creation_idempotency_key IS NOT NULL;

ALTER TABLE resume_versions ADD COLUMN IF NOT EXISTS source_type TEXT;
UPDATE resume_versions SET source_type = 'uploaded' WHERE source_type IS NULL;
ALTER TABLE resume_versions ALTER COLUMN source_type SET DEFAULT 'uploaded';
ALTER TABLE resume_versions ALTER COLUMN source_type SET NOT NULL;
ALTER TABLE resume_versions ALTER COLUMN original_filename DROP NOT NULL;
ALTER TABLE resume_versions ALTER COLUMN stored_path DROP NOT NULL;

ALTER TABLE interview_resume_snapshots ADD COLUMN IF NOT EXISTS source_type TEXT;
UPDATE interview_resume_snapshots SET source_type = 'uploaded' WHERE source_type IS NULL;
ALTER TABLE interview_resume_snapshots ALTER COLUMN source_type SET DEFAULT 'uploaded';
ALTER TABLE interview_resume_snapshots ALTER COLUMN source_type SET NOT NULL;
ALTER TABLE interview_resume_snapshots ALTER COLUMN original_filename DROP NOT NULL;
ALTER TABLE interview_resume_snapshots ALTER COLUMN stored_path DROP NOT NULL;
```

Drop and recreate named check constraints idempotently. Update both fresh-table definitions and snapshot backfill columns to include `source_type`.

- [ ] **Step 4: Update snapshot and deletion helpers**

Change `ResumeSnapshotSource` attachment fields to `string | null`, add `sourceType`, and change `selectDeletableResumeAttachments` to accept nullable paths:

```ts
export function selectDeletableResumeAttachments(
  versionPaths: Array<string | null>,
  snapshotPaths: Array<string | null>,
) {
  const protectedPaths = new Set(snapshotPaths.filter((path): path is string => Boolean(path)));
  return [...new Set(versionPaths.filter((path): path is string => Boolean(path)))]
    .filter((path) => !protectedPaths.has(path));
}
```

Filter non-null version paths before calling `inArray`. If none exist, skip the snapshot attachment query.

- [ ] **Step 5: Copy `sourceType` into immutable snapshots**

Add `sourceType: resumeVersions.sourceType` to the source selection in `createDrizzleAgentInterviewStore`. Pass it through `createResumeSnapshotPayload`.

Run: `pnpm exec tsx --test lib/interview/resume-snapshot.test.ts lib/interview/resume-snapshot.integration.test.ts`

Expected: unit tests PASS; integration tests PASS when `DATABASE_URL` is set or report SKIP otherwise.

- [ ] **Step 6: Run migration against the development database**

Run: `pnpm db:migrate`

Expected: migration completes without constraint or backfill errors. Run it a second time and expect the same successful completion.

- [ ] **Step 7: Commit**

```bash
git add lib/db/schema.ts lib/db/migrate.ts lib/resume/types.ts lib/interview/resume-snapshot.ts lib/interview/resume-snapshot.test.ts lib/interview/agent/drizzle-store.ts
git commit -m "feat(resume): support generated resume sources"
```

### Task 3: Truth-constrained structured AI generation

**Files:**
- Create: `lib/resume/generate-resume.ts`
- Create: `lib/resume/generate-resume.test.ts`
- Modify: `lib/ai/model-policy.ts`
- Modify: `lib/ai/model-policy.test.ts`

**Interfaces:**
- Consumes: `GeneratedResumeInput`.
- Produces: `generateResumeWithAI(input, options?): Promise<ParsedResume>`.

- [ ] **Step 1: Add failing model-policy and generator tests**

Add `"resume.generate": "fast"` to the expected tier map test.

Test `generateResumeWithAI` with an injected structured generator that returns fabricated optional sections. Assert the final result preserves exact name, role, and skills and clears education, experience, projects, and contact when their source inputs are blank. Add a second case with factual optional inputs and assert the generator prompt contains those facts, the requested locale, and explicit non-fabrication language.

Run: `pnpm exec tsx --test lib/ai/model-policy.test.ts lib/resume/generate-resume.test.ts`

Expected: FAIL because the task and generator do not exist.

- [ ] **Step 2: Register the generation model task**

Add `"resume.generate"` to `AITask` and map it to `"fast"` in `taskTiers`.

- [ ] **Step 3: Implement deterministic output overlay**

Create `generateResumeWithAI` using `generateStructured({ task: "resume.generate", schema: parsedResumeSchema, ... })`. Build the prompt with `JSON.stringify` around the validated factual input. State that the JSON is data, not instructions.

After model output, return `parsedResumeSchema.parse` of:

```ts
{
  ...modelOutput,
  name: input.name,
  title: input.targetRole,
  skills: input.coreSkills,
  contact: input.additionalInfo ? modelOutput.contact : undefined,
  experience: input.workExperience ? modelOutput.experience : [],
  education: input.education ? modelOutput.education : [],
  projects: input.additionalInfo ? modelOutput.projects : [],
}
```

The system prompt must contain the approved PRD constraints and instruct uncertain facts to be omitted. Pass `options?.abortSignal` through to the AI gateway. Allow `options?.generate` injection for unit tests while defaulting to `generateStructured`.

- [ ] **Step 4: Run AI unit tests**

Run: `pnpm exec tsx --test lib/ai/model-policy.test.ts lib/resume/generate-resume.test.ts`

Expected: all tests PASS without live model credentials.

- [ ] **Step 5: Commit**

```bash
git add lib/ai/model-policy.ts lib/ai/model-policy.test.ts lib/resume/generate-resume.ts lib/resume/generate-resume.test.ts
git commit -m "feat(resume): generate structured resumes from facts"
```

### Task 4: Atomic idempotent persistence and API

**Files:**
- Create: `lib/resume/generated-resume-store.ts`
- Create: `lib/resume/generated-resume-store.integration.test.ts`
- Create: `app/api/resumes/generate/route.ts`
- Modify: `app/api/resumes/upload/route.ts`
- Modify: `app/api/resumes/route.ts`
- Modify: `components/dashboard/types.ts`

**Interfaces:**
- Consumes: validated input, `ParsedResume`, and canonical text.
- Produces: `findGeneratedResumeByKey(database, ownerUserId, key)` and `persistGeneratedResume(database, input)`.
- API: `POST /api/resumes/generate` returns `{ id, versionId, status: "parsed", data }`.

- [ ] **Step 1: Add a failing real-database idempotency test**

Create a test skipped without `DATABASE_URL`. Insert a user, call `persistGeneratedResume` concurrently four times with the same owner, key, title, parsed JSON, and canonical text, then assert:

```ts
assert.equal(new Set(results.map((result) => result.id)).size, 1);
assert.equal(new Set(results.map((result) => result.versionId)).size, 1);
assert.equal(rows.length, 1);
assert.equal(versions.length, 1);
assert.equal(versions[0].sourceType, "generated");
assert.equal(versions[0].storedPath, null);
assert.equal(versions[0].originalFilename, null);
```

Run: `pnpm exec tsx --test lib/resume/generated-resume-store.integration.test.ts`

Expected: FAIL because the store does not exist.

- [ ] **Step 2: Implement atomic persistence**

Use pre-generated Resume and version UUIDs. Inside one transaction:

1. Query by `(userId, creationIdempotencyKey)` and return the existing Resume/current version if found.
2. Insert Resume with `title`, `currentVersionId`, and `creationIdempotencyKey` using `onConflictDoNothing`.
3. If the insert lost a race, query and return the winner.
4. Insert version 1 with `sourceType: "generated"`, all attachment fields null, canonical `extractedText`, parsed JSON, and `parseStatus: "parsed"`.
5. Return the new identifiers and parsed data.

Throw `"Idempotent generated resume creation could not be resolved"` only if the unique-conflict winner cannot be loaded.

- [ ] **Step 3: Implement the authenticated route**

The route must:

```ts
const userId = await getCurrentUserId();
if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
const parsed = generatedResumeRequestSchema.safeParse(await request.json());
if (!parsed.success) {
  return NextResponse.json(
    { error: "Invalid request body", details: parsed.error.flatten() },
    { status: 400 },
  );
}
const existing = await findGeneratedResumeByKey(db, userId, parsed.data.idempotencyKey);
if (existing) return NextResponse.json(existing);
const generated = await generateResumeWithAI(parsed.data, { abortSignal: request.signal });
const result = await persistGeneratedResume(db, {
  ownerUserId: userId,
  idempotencyKey: parsed.data.idempotencyKey,
  title: parsed.data.targetRole,
  parsed: generated,
  extractedText: serializeParsedResume(generated),
});
return NextResponse.json(result, { status: 201 });
```

Catch failures, log only `sanitizeAIError(error)`, and return `{ error: "Failed to generate resume" }` with status 500.

- [ ] **Step 4: Expose source type in existing APIs**

Set `sourceType: "uploaded"` explicitly in the upload insert. Return `sourceType`, nullable `originalFilename`, and nullable `originalFileUrl` from `GET /api/resumes`. Update `ResumeVersion` accordingly.

- [ ] **Step 5: Run store and contract tests**

Run: `pnpm exec tsx --test lib/resume/*.test.ts`

Expected: all unit tests PASS; database integration PASS with `DATABASE_URL` or SKIP without it.

- [ ] **Step 6: Commit**

```bash
git add app/api/resumes/generate/route.ts app/api/resumes/upload/route.ts app/api/resumes/route.ts components/dashboard/types.ts lib/resume/generated-resume-store.ts lib/resume/generated-resume-store.integration.test.ts
git commit -m "feat(resume): persist generated resume versions"
```

### Task 5: Animated new-resume dialog and generator form

**Files:**
- Create: `components/dashboard/upload-resume-form.tsx`
- Create: `components/dashboard/generated-resume-form.tsx`
- Create: `components/dashboard/new-resume-dialog.tsx`
- Delete: `components/dashboard/upload-resume-dialog.tsx`
- Modify: `app/(app)/dashboard/page.tsx`
- Modify: `components/dashboard/resume-sidebar.tsx`
- Modify: `lib/i18n/dictionaries/zh.ts`
- Modify: `lib/i18n/dictionaries/en.ts`

**Interfaces:**
- Consumes: `GeneratedResumeDraft`.
- Produces: a controlled `NewResumeDialog` with upload/generate modes and `onGenerate(draft)`.

- [ ] **Step 1: Extract the existing upload form without behavior changes**

Move the existing title input, file drop area, upload error, and action buttons into `UploadResumeForm`. Keep every existing prop except `open` and `onOpenChange`. Render it inside the old dialog temporarily and run:

Run: `npx tsc --noEmit`

Expected: PASS with the upload flow unchanged.

- [ ] **Step 2: Add localized generator copy and quick choices**

Add complete `zh` and `en` keys for:

- New resume title and both tab labels.
- Generator subtitle, six labels, required/optional badges, placeholders, helper text, generate/cancel/loading text.
- Required-field, request-failure, and generated-no-original messages.
- Localized role and skill suggestion arrays.
- AI-generated source badge and original-file tooltip.

Use role suggestions spanning frontend, backend, full stack, product, UI/UX, data analysis, DevOps, testing, operations, and design rather than only engineering roles.

- [ ] **Step 3: Build the six-field generated form**

Use controlled inputs and `Textarea`. Clicking a role suggestion replaces `targetRole`. Clicking a skill suggestion appends it only if its case-insensitive normalized key is absent. Render required state for target role and skills. Disable submit when normalized skills are empty, target role is blank, or `generating` is true. Apply the exact `maxLength` values from Global Constraints.

- [ ] **Step 4: Build the animated dialog shell**

Use Radix `Tabs`. Keep both tab panels mounted so drafts survive switching. Apply:

```ts
const contentClassName = cn(
  "overflow-hidden p-0 [interpolate-size:allow-keywords]",
  "transition-[width,max-width,height] duration-300 ease-out motion-reduce:transition-none",
  mode === "generate"
    ? "h-[90vh] sm:max-w-5xl"
    : "h-auto sm:max-w-md",
);
```

Keep the generator body scrollable and its footer sticky. Fade generator content with a short delayed opacity transition; remove the delay under `motion-reduce`. Reset mode and both drafts only when the dialog closes or an operation succeeds.

- [ ] **Step 5: Wire dashboard generation state and idempotency**

Add `generatedDraft`, `generating`, `generateError`, and a `{ signature, key }` ref. Build the signature from locale plus all six draft fields. Reuse the key while the signature is unchanged and generate a new `crypto.randomUUID()` when it changes.

On success, perform:

```ts
setUploadOpen(false);
setSelectedResumeId(data.id);
setSelectedVersionId(data.versionId);
setExpandedFolders((previous) => new Set([...previous, data.id]));
setPreviewMode("parsed");
await fetchResumes();
```

On failure, keep the dialog and draft open. Rename sidebar/button copy from upload to new resume. Replace `UploadResumeDialog` with `NewResumeDialog`.

- [ ] **Step 6: Verify interaction manually**

Run: `pnpm dev`

Expected:

- Dialog opens compact on upload.
- Generate tab expands to `sm:max-w-5xl` and `90vh` smoothly.
- Returning to upload contracts smoothly.
- Reduced-motion browser setting removes the transition.
- Tab drafts survive tab changes and reset after close.
- Long generated form scrolls while actions remain visible.
- A failed request preserves input.

- [ ] **Step 7: Commit**

```bash
git add 'app/(app)/dashboard/page.tsx' components/dashboard/upload-resume-form.tsx components/dashboard/generated-resume-form.tsx components/dashboard/new-resume-dialog.tsx components/dashboard/upload-resume-dialog.tsx components/dashboard/resume-sidebar.tsx lib/i18n/dictionaries/zh.ts lib/i18n/dictionaries/en.ts
git commit -m "feat(dashboard): add animated resume generator"
```

### Task 6: Source-aware editing, previews, and interview snapshots

**Files:**
- Modify: `app/api/resumes/[id]/versions/[versionId]/edit/route.ts`
- Modify: `components/dashboard/resume-preview-pane.tsx`
- Modify: `app/api/interviews/[id]/route.ts`
- Modify: `app/(app)/interviews/[interviewId]/room/page.tsx`
- Modify: `components/interview/agent-interview-room.tsx`
- Modify: `components/interview/interview-resume-context-sheet.tsx`
- Modify: `lib/interview/resume-snapshot.integration.test.ts`

**Interfaces:**
- Consumes: `sourceType` and nullable attachment metadata from Task 2.
- Produces: generated edits that remain generated; disabled original-file controls with localized explanations.

- [ ] **Step 1: Add a generated snapshot integration case**

Create a generated Resume v1 with null attachments, create an interview through `createDrizzleAgentInterviewStore`, and assert the snapshot has `sourceType === "generated"`, null attachment fields, non-empty canonical text, and unchanged parsed JSON. Delete the source Resume and assert the historical snapshot and interview remain.

Run: `pnpm exec tsx --test lib/interview/resume-snapshot.integration.test.ts`

Expected: FAIL until all source fields are propagated.

- [ ] **Step 2: Preserve source semantics on edit**

In the edit route, copy `sourceType`, nullable attachment fields, extracted text, and parsed JSON from the source version. For generated versions, recompute `extractedText` with `serializeParsedResume(parsed.data)` so v2 grounding matches the edit. For uploaded versions, retain the original extracted PDF text and attachment.

- [ ] **Step 3: Make dashboard preview source-aware**

Show an “AI generated” badge when `selectedVersion.sourceType === "generated"`. Keep the original button visible but disabled. Wrap its disabled element in a tooltip trigger wrapper and show the localized no-original explanation. Never instantiate `ResumePdfPreview` without both a non-null URL and filename.

- [ ] **Step 4: Propagate source type through interview reads**

Return `sourceType` and nullable `originalFilename` in `GET /api/interviews/[id]`. Update `ResumeSnapshotData`, `ResumeSnapshot`, and `InterviewResumeSnapshot` types. In `InterviewResumeContextSheet`, keep the Original tab visible and disabled for generated snapshots, with the localized tooltip. Keep parsed as the resolved default.

- [ ] **Step 5: Run snapshot and type checks**

Run: `pnpm exec tsx --test lib/interview/resume-snapshot.test.ts lib/interview/resume-snapshot.integration.test.ts`

Expected: all unit tests PASS; integration PASS or SKIP only when the database is unavailable.

Run: `npx tsc --noEmit`

Expected: PASS with no nullable attachment errors.

- [ ] **Step 6: Commit**

```bash
git add 'app/api/resumes/[id]/versions/[versionId]/edit/route.ts' components/dashboard/resume-preview-pane.tsx 'app/api/interviews/[id]/route.ts' 'app/(app)/interviews/[interviewId]/room/page.tsx' components/interview/agent-interview-room.tsx components/interview/interview-resume-context-sheet.tsx lib/interview/resume-snapshot.integration.test.ts
git commit -m "feat(resume): support generated resume previews"
```

### Task 7: Full regression and acceptance verification

**Files:**
- Modify only files required to fix failures found by the commands below.

**Interfaces:**
- Consumes all previous tasks.
- Produces a release-ready feature matching the approved design.

- [ ] **Step 1: Run the complete automated suite**

Run: `pnpm test`

Expected: all tests PASS; database-backed tests may SKIP only when `DATABASE_URL` is not configured.

- [ ] **Step 2: Run static validation**

Run: `pnpm lint`

Expected: exit code 0.

Run: `npx tsc --noEmit`

Expected: exit code 0.

- [ ] **Step 3: Run production build**

Run: `pnpm build`

Expected: Next.js production build completes successfully.

- [ ] **Step 4: Run database migration twice**

Run: `pnpm db:migrate && pnpm db:migrate`

Expected: both runs complete successfully, proving migration rerunnability.

- [ ] **Step 5: Execute acceptance flow**

With `pnpm dev`:

1. Open New resume and confirm upload remains compact and functional.
2. Switch to AI generate and confirm smooth expansion, scrolling, sticky actions, and localized quick choices.
3. Submit only target role and skills; confirm v1 is selected, parsed preview is default, and optional sections are empty.
4. Confirm Original remains visible but disabled with explanatory tooltip.
5. Edit the generated resume; confirm v2 remains generated and attachment-free.
6. Configure and start an interview; confirm the room parsed-resume sheet works and Original is disabled.
7. Delete the source resume after creating an interview; confirm historical interview snapshot content remains.
8. Upload a PDF and confirm parse, preview, reparse, edit, configuration, and interview creation still work.

- [ ] **Step 6: Commit any verification fixes**

If Step 1–5 required code changes, stage only those files and commit:

```bash
git commit -m "fix(resume): complete generator regressions"
```

If no files changed, do not create an empty commit.
