# AI resume generator

## Goal

Add an AI resume generator beside the existing PDF upload flow. A generated resume is a first-class resume version with structured content but no original attachment. It can be edited, versioned, selected for interviews, and copied into immutable interview snapshots exactly like an uploaded resume.

The generator must never invent experience. It may organize, rewrite, and summarize facts supplied by the user. Optional fields left blank remain empty.

## Scope

This feature includes:

- A two-tab “New resume” dialog with “Upload file” and “AI generate” modes.
- A fact-entry form for generated resumes.
- Structured AI generation into the existing `ParsedResume` contract.
- Native persistence for resume versions and interview snapshots without attachments.
- Existing resume editing, interview creation, and snapshot behavior for generated resumes.
- Chinese and English UI and generated output.
- PRD and core project-instruction updates for the new resume source.

This feature does not include:

- Generating or exporting a PDF or DOCX file.
- Resume templates or visual layout selection.
- Inventing projects, employers, schools, dates, responsibilities, results, or qualifications.
- Adding new fields to the public `ParsedResume` structure.
- Changing interview flow, scoring, or report behavior.

## Product decisions

- The existing resume entry opens one dialog. Its two tabs are “Upload file” and “AI generate.”
- Generating always creates a new independent Resume with version 1. It never overwrites the selected resume and never creates a version under it.
- Generation success immediately persists the resume, closes the dialog, selects the new version, and shows its parsed preview.
- The resume title is the supplied target role.
- Generated output follows the current interface language.
- A generated resume has no original file. The product does not create placeholder attachment metadata or a synthetic document.

## Generator form

The generated-resume form contains exactly six inputs:

| Field | Required | Meaning |
| --- | --- | --- |
| Name | No | Candidate name; blank remains blank |
| Target role | Yes | Desired role and persisted resume title |
| Core skills | Yes | Comma-, Chinese-comma-, or newline-separated facts |
| Education | No | Free-text factual education history |
| Work experience | No | Free-text factual employment history |
| Additional information | No | Factual projects, contact details, certificates, languages, and similar supporting information |

Target-role quick choices cover technical, product, design, operations, and data roles and are localized. Skill quick choices are localized and add editable skills. Before submission, skills are trimmed, empty entries are discarded, and duplicates are removed.

The generate action is disabled until target role and at least one normalized skill are present. Client and server enforce the same limits:

- Name: 100 characters.
- Target role: 100 characters.
- Raw core-skills input: 1,000 characters; at most 50 normalized skills and 100 characters per skill.
- Education: 3,000 characters.
- Work experience: 5,000 characters.
- Additional information: 5,000 characters.

## Dialog interaction

The dialog opens on the existing upload tab at its current compact width.

Selecting “AI generate” smoothly expands the dialog to `sm:max-w-5xl` with a `90vh` maximum height. Selecting “Upload file” smoothly returns it to the existing `sm:max-w-md` footprint. Width, height, border radius, and content opacity use coordinated transitions so content does not jump or flash. Generated-form content fades in after the container has enough space. The form body scrolls independently while its action bar remains visible.

Users with `prefers-reduced-motion` receive an immediate state change without forced animation.

Switching tabs preserves the draft belonging to each tab. Cancelling or closing the dialog resets both drafts. A successful upload or generation also resets both drafts.

## Data model

### Resume versions

Add `sourceType` to `resume_versions` with allowed values `uploaded` and `generated`. It is non-null and defaults to `uploaded`; all existing rows are treated or backfilled as `uploaded`.

The database enforces the two allowed source values, while request schemas enforce the same union at application boundaries.

Make these fields nullable:

- `originalFilename`
- `storedPath`
- `mimeType`
- `fileSize`

Uploaded versions continue to require real attachment metadata at the application boundary. Generated versions store all four attachment fields as `null`.

A generated version stores:

- `sourceType = generated`
- `parseStatus = parsed`
- a schema-valid `parsedJson`
- a deterministic canonical text serialization in `extractedText`
- no attachment metadata

The canonical text is derived only from `parsedJson`, uses stable section ordering, and preserves all non-empty structured facts. It is the text representation used by interview grounding where existing code expects extracted resume text.

### Interview snapshots

Add the same `sourceType` to `interview_resume_snapshots` and make its attachment fields nullable. Snapshot creation copies the source type, canonical text, and structured JSON. Uploaded snapshots retain attachment metadata; generated snapshots store it as `null`.

Snapshot immutability and historical-read behavior do not change. A generated snapshot remains usable for interview execution, scoring, reports, and deep dives without a source attachment.

### Edited versions

Editing any structured resume continues to create a new immutable version.

- An edited generated version inherits `sourceType = generated` and has no attachment.
- An edited uploaded version inherits `sourceType = uploaded` and continues to reference its source attachment.

Deleting a generated resume performs no attachment deletion. Attachment cleanup considers only non-null stored paths and continues protecting files referenced by interview snapshots.

### Idempotency

Generated-resume creation accepts a client idempotency key scoped to the current user. Add a nullable `creationIdempotencyKey` to Resume and enforce uniqueness on `(userId, creationIdempotencyKey)` when the key is present. Upload-created resumes leave the field null. A retry after an unknown client outcome returns the already-created resume. If concurrent requests with the same key race, the unique-constraint loser reads and returns the winner. Changing any form field creates a new request signature and key.

## API and service flow

Create a generation endpoint separate from the multipart upload endpoint.

1. Authenticate the current user.
2. Validate the request, locale, idempotency key, required fields, normalized skills, and field bounds.
3. Return the existing created resume immediately if the idempotency key has already completed.
4. Ask the model for a structured `ParsedResume`.
5. Apply deterministic fields and fact-preservation rules.
6. Validate the final result with `parsedResumeSchema`.
7. Serialize the result to canonical text.
8. In one database transaction, insert the Resume and generated version 1 and set `currentVersionId`.
9. Return the created resume and version identifiers plus parsed data.

No database record is created before successful model output and schema validation. The transaction prevents partial Resume/version state.

## AI contract and fact safety

The generation task has its own model-policy task name and structured schema. Its system and developer prompts explicitly state:

- Only user-provided facts may appear.
- Missing information stays empty.
- Unclear information is omitted instead of inferred.
- The model may reorganize and professionally rewrite facts.
- A summary may synthesize supplied facts but may not add claims.
- A project is emitted only when the user explicitly supplied a real project.
- Employers, schools, dates, titles, responsibilities, metrics, qualifications, and contact details must not be invented.
- Output language follows the validated interface locale.

The server, not the model, writes the normalized name, target role, and core skills into the final structure. Optional narrative inputs are the only source for education, work experience, projects, contact details, and summary claims. The final object must pass `parsedResumeSchema`; otherwise generation fails without persistence.

## Dashboard behavior

After successful generation:

- Close the dialog.
- Refresh the resume list.
- Expand and select the new Resume and version 1.
- Set preview mode to parsed.
- Show a source indicator that the version was AI-generated.
- Keep the original-file control visible but disabled, with localized tooltip text explaining that an AI-generated version has no original file.

The parsed preview, structured editor, interview settings, and start-interview controls remain the same. Saving an edit selects the newly created generated version.

The interview-room resume sheet and any historical snapshot views default to parsed content for generated snapshots. They do not render or request a PDF viewer when `storedPath` is null. The original-file tab remains visible but disabled with the same localized explanation.

## Loading and error behavior

While generation is running, form controls and the submit action are locked to prevent duplicate submissions.

- Client validation marks the relevant field.
- Authentication and request validation use normal API status codes.
- Model, configuration, network, or schema failures leave the dialog open and preserve all input.
- Database failures roll back the complete create operation.
- Localized error copy does not expose provider payloads, prompts, keys, or internal model details.
- A retry reuses the request idempotency key unless the user changes form content.

Upload errors and reparse behavior remain unchanged.

## Testing

### Data and services

- Existing versions and snapshots are `uploaded` after migration and retain attachment values.
- Generated versions and snapshots accept null attachment fields.
- Uploaded application paths still reject missing required files.
- Generation rejects a missing target role or empty normalized skills.
- Optional blank inputs produce no invented education, experience, projects, or contact data.
- Deterministic name, role, and skills are not changed by model output.
- Invalid structured output creates no database rows.
- Resume and version 1 are created atomically.
- The same idempotency key creates one resume and returns it on retry.
- A changed request uses a new idempotency key.
- Canonical text is stable and contains every non-empty structured section.
- Editing generated and uploaded resumes preserves their respective source semantics.
- Generated resume deletion performs no file deletion.
- Generated resume interview creation produces a valid immutable snapshot.

### UI

- The dialog defaults to the compact upload tab.
- Switching to generate expands it smoothly; switching back restores the compact size.
- Reduced-motion settings disable the transition.
- Each tab preserves its draft during tab switches and resets on close or success.
- Required-field state controls submission.
- Loading state prevents duplicate submission.
- Success selects the new parsed version.
- Generated versions have no usable original-file action.
- Chinese and English locales produce matching UI and output-language requests.
- The existing upload, reparse, edit, interview setup, and interview creation flows continue to work.

### Verification

Run relevant unit and integration tests, `pnpm lint`, `npx tsc --noEmit`, and `pnpm build`. Visually verify the responsive dialog transition, long-form scrolling, fixed action area, parsed-default selection, and generated-snapshot resume sheet.

## Acceptance criteria

The feature is complete when a signed-in user can open “New resume,” switch to the smoothly expanded generator, submit only a target role and at least one skill, and receive a new parsed Resume v1 whose optional sections remain empty and whose attachment fields are null. The resume must be editable, selectable for a normal snapshot-backed interview, and visible throughout interview history without any original-file request. Existing uploaded resumes must behave exactly as before.
