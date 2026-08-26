import { sql } from "drizzle-orm";
import {
  AnyPgColumn,
  bigint,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { ResumeSourceType } from "@/lib/resume/types";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name"),
  passwordHash: text("password_hash"),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const oauthAccounts = pgTable("oauth_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  providerAccountId: text("provider_account_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [unique().on(table.provider, table.providerAccountId)]);

export const resumes = pgTable("resumes", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  currentVersionId: uuid("current_version_id"),
  creationIdempotencyKey: text("creation_idempotency_key"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("idx_resumes_creation_owner_key")
    .on(table.userId, table.creationIdempotencyKey)
    .where(sql`${table.userId} IS NOT NULL AND ${table.creationIdempotencyKey} IS NOT NULL`),
]);

export const resumeVersions = pgTable("resume_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  resumeId: uuid("resume_id")
    .notNull()
    .references(() => resumes.id, { onDelete: "cascade" }),
  versionNumber: integer("version_number").notNull(),
  sourceType: text("source_type").$type<ResumeSourceType>().notNull().default("uploaded"),
  originalFilename: text("original_filename"),
  storedPath: text("stored_path"),
  mimeType: text("mime_type"),
  fileSize: integer("file_size"),
  extractedText: text("extracted_text"),
  parsedJson: jsonb("parsed_json"),
  parseStatus: text("parse_status").notNull().default("uploaded"),
  parseError: text("parse_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("idx_resume_versions_resume_number")
    .on(table.resumeId, table.versionNumber),
  check("resume_versions_source_type_check", sql`${table.sourceType} IN ('uploaded', 'generated')`),
  check(
    "resume_versions_generated_attachment_check",
    sql`${table.sourceType} <> 'generated' OR (${table.originalFilename} IS NULL AND ${table.storedPath} IS NULL AND ${table.mimeType} IS NULL AND ${table.fileSize} IS NULL)`,
  ),
]);

export const aiTaskRuns = pgTable("ai_task_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  operationKey: text("operation_key").notNull(),
  task: text("task").notNull(),
  status: text("status").notNull().default("running"),
  budgetMode: text("budget_mode").notNull(),
  budgetScope: text("budget_scope"),
  tokenLimit: bigint("token_limit", { mode: "number" }),
  wouldExceedBudget: integer("would_exceed_budget").notNull().default(0),
  inputTokens: bigint("input_tokens", { mode: "number" }).notNull().default(0),
  outputTokens: bigint("output_tokens", { mode: "number" }).notNull().default(0),
  cachedInputTokens: bigint("cached_input_tokens", { mode: "number" }).notNull().default(0),
  cacheWriteTokens: bigint("cache_write_tokens", { mode: "number" }).notNull().default(0),
  usageUnavailableAttempts: integer("usage_unavailable_attempts").notNull().default(0),
  estimatedCostMicros: bigint("estimated_cost_micros", { mode: "number" }),
  unpricedAttempts: integer("unpriced_attempts").notNull().default(0),
  promptTemplateVersion: text("prompt_template_version"),
  errorJson: jsonb("error_json"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("idx_ai_task_runs_operation_key").on(table.operationKey)]);

export const aiTaskAttempts = pgTable("ai_task_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskRunId: uuid("task_run_id")
    .notNull()
    .references(() => aiTaskRuns.id, { onDelete: "cascade" }),
  attemptNumber: integer("attempt_number").notNull(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  credentialTier: text("credential_tier").notNull(),
  status: text("status").notNull().default("running"),
  usageAvailable: integer("usage_available").notNull().default(0),
  inputTokens: bigint("input_tokens", { mode: "number" }).notNull().default(0),
  outputTokens: bigint("output_tokens", { mode: "number" }).notNull().default(0),
  cachedInputTokens: bigint("cached_input_tokens", { mode: "number" }),
  cacheWriteTokens: bigint("cache_write_tokens", { mode: "number" }),
  inputPriceMicrosPerMillion: bigint("input_price_micros_per_million", { mode: "number" }),
  outputPriceMicrosPerMillion: bigint("output_price_micros_per_million", { mode: "number" }),
  cacheReadPriceMicrosPerMillion: bigint("cache_read_price_micros_per_million", { mode: "number" }),
  cacheWritePriceMicrosPerMillion: bigint("cache_write_price_micros_per_million", { mode: "number" }),
  estimatedCostMicros: bigint("estimated_cost_micros", { mode: "number" }),
  firstTokenMs: integer("first_token_ms"),
  durationMs: integer("duration_ms"),
  errorCategory: text("error_category"),
  retryable: integer("retryable"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("idx_ai_task_attempts_run_number").on(table.taskRunId, table.attemptNumber),
]);

export const agentSessions = pgTable("agent_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull().default("New agent task"),
  model: text("model").notNull(),
  capability: text("capability").notNull().default("workspace"),
  promptVersion: text("prompt_version").notNull().default("workspace-agent-v1"),
  systemPrompt: text("system_prompt").notNull(),
  workspaceRoot: text("workspace_root"),
  status: text("status").notNull().default("idle"),
  nextEventSequence: integer("next_event_sequence").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("agent_sessions_status_check", sql`${table.status} IN ('idle', 'running', 'failed')`),
  check(
    "agent_sessions_capability_workspace_check",
    sql`${table.capability} <> 'workspace' OR ${table.workspaceRoot} IS NOT NULL`,
  ),
]);

export const agentRuns = pgTable("agent_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => agentSessions.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("queued"),
  maxSteps: integer("max_steps").notNull(),
  inputTokens: bigint("input_tokens", { mode: "number" }),
  outputTokens: bigint("output_tokens", { mode: "number" }),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => [
  check("agent_runs_status_check", sql`${table.status} IN ('queued', 'running', 'completed', 'failed', 'cancelled')`),
  uniqueIndex("idx_agent_runs_session_active")
    .on(table.sessionId)
    .where(sql`${table.status} IN ('queued', 'running')`),
]);

export const agentEvents = pgTable("agent_events", {
  id: serial("id").primaryKey(),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => agentSessions.id, { onDelete: "cascade" }),
  runId: uuid("run_id").references(() => agentRuns.id, { onDelete: "set null" }),
  sequence: integer("sequence").notNull(),
  type: text("type").notNull(),
  payload: jsonb("payload").notNull(),
  dedupeKey: text("dedupe_key"),
  schemaVersion: integer("schema_version").notNull().default(1),
  visibility: text("visibility").notNull().default("model"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("idx_agent_events_session_sequence").on(table.sessionId, table.sequence),
  uniqueIndex("idx_agent_events_session_dedupe_key")
    .on(table.sessionId, table.dedupeKey)
    .where(sql`${table.dedupeKey} IS NOT NULL`),
  index("idx_agent_events_session_type_sequence").on(table.sessionId, table.type, table.sequence),
  check("agent_events_schema_version_check", sql`${table.schemaVersion} > 0`),
  check(
    "agent_events_visibility_check",
    sql`${table.visibility} IN ('model', 'user', 'model_and_user', 'internal')`,
  ),
]);

export const interviews = pgTable("interviews", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  creationIdempotencyKey: text("creation_idempotency_key").notNull(),
  creationRequestHash: text("creation_request_hash").notNull(),
  agentSessionId: uuid("agent_session_id")
    .notNull()
    .references(() => agentSessions.id, { onDelete: "cascade" }),
  resumeVersionId: uuid("resume_version_id").notNull(),
  status: text("status").notNull().default("initializing"),
  language: text("language").notNull(),
  persona: text("persona").notNull(),
  interviewType: text("interview_type").notNull(),
  targetLevel: text("target_level").notNull(),
  targetRole: text("target_role").notNull(),
  preference: text("preference").notNull().default(""),
  preferenceTags: jsonb("preference_tags").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  targetRoundCount: integer("target_round_count").notNull(),
  answeredRoundCount: integer("answered_round_count").notNull().default(0),
  version: integer("version").notNull().default(1),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("idx_interviews_owner_creation_key").on(table.userId, table.creationIdempotencyKey),
  uniqueIndex("idx_interviews_agent_session").on(table.agentSessionId),
  index("idx_interviews_owner_created").on(table.userId, table.createdAt),
  check("interviews_status_check", sql`${table.status} IN ('initializing', 'active', 'completing', 'completed')`),
  check("interviews_language_check", sql`${table.language} IN ('zh', 'en', 'es', 'de')`),
  check("interviews_persona_check", sql`${table.persona} IN ('friendly', 'standard', 'stressful')`),
  check("interviews_type_check", sql`${table.interviewType} IN ('behavioral', 'technical', 'mixed')`),
  check("interviews_target_level_check", sql`${table.targetLevel} IN ('Junior', 'Mid', 'Senior')`),
  check("interviews_target_round_count_check", sql`${table.targetRoundCount} BETWEEN 1 AND 20`),
  check(
    "interviews_answered_round_count_check",
    sql`${table.answeredRoundCount} >= 0 AND ${table.answeredRoundCount} <= ${table.targetRoundCount}`,
  ),
  check("interviews_version_check", sql`${table.version} > 0`),
  check(
    "interviews_preference_tags_check",
    sql`jsonb_typeof(${table.preferenceTags}) = 'array' AND jsonb_array_length(${table.preferenceTags}) <= 3`,
  ),
]);

export const interviewResumeSnapshots = pgTable("interview_resume_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  interviewId: uuid("interview_id")
    .notNull()
    .references(() => interviews.id, { onDelete: "cascade" }),
  resumeId: uuid("resume_id").notNull(),
  resumeVersionId: uuid("resume_version_id").notNull(),
  resumeTitle: text("resume_title").notNull(),
  versionNumber: integer("version_number").notNull(),
  sourceType: text("source_type").$type<ResumeSourceType>().notNull(),
  parsedJson: jsonb("parsed_json").notNull(),
  canonicalText: text("canonical_text").notNull(),
  evidenceJson: jsonb("evidence_json").notNull(),
  contentHash: text("content_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("idx_interview_resume_snapshots_interview").on(table.interviewId),
  check("interview_resume_snapshots_version_check", sql`${table.versionNumber} > 0`),
  check("interview_resume_snapshots_source_type_check", sql`${table.sourceType} IN ('uploaded', 'generated')`),
]);

export const interviewQuestions = pgTable("interview_questions", {
  id: uuid("id").primaryKey().defaultRandom(),
  interviewId: uuid("interview_id")
    .notNull()
    .references(() => interviews.id, { onDelete: "cascade" }),
  sourceInterviewRunId: uuid("source_interview_run_id")
    .notNull()
    .references((): AnyPgColumn => interviewAgentRuns.id, { onDelete: "restrict" }),
  sequence: integer("sequence").notNull(),
  kind: text("kind").notNull(),
  topic: text("topic").notNull(),
  question: text("question").notNull(),
  tip: text("tip"),
  resumeEvidenceIds: jsonb("resume_evidence_ids").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  status: text("status").notNull().default("awaiting_answer"),
  askedAt: timestamp("asked_at", { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("idx_interview_questions_sequence").on(table.interviewId, table.sequence),
  uniqueIndex("idx_interview_questions_source_run").on(table.sourceInterviewRunId),
  uniqueIndex("idx_interview_questions_one_awaiting")
    .on(table.interviewId)
    .where(sql`${table.status} = 'awaiting_answer'`),
  check("interview_questions_sequence_check", sql`${table.sequence} > 0`),
  check("interview_questions_kind_check", sql`${table.kind} IN ('main', 'follow_up')`),
  check(
    "interview_questions_status_check",
    sql`${table.status} IN ('awaiting_answer', 'answered', 'skipped', 'abandoned')`,
  ),
  check("interview_questions_evidence_check", sql`jsonb_typeof(${table.resumeEvidenceIds}) = 'array'`),
]);

export const interviewAnswers = pgTable("interview_answers", {
  id: uuid("id").primaryKey().defaultRandom(),
  interviewId: uuid("interview_id")
    .notNull()
    .references(() => interviews.id, { onDelete: "cascade" }),
  questionId: uuid("question_id")
    .notNull()
    .references(() => interviewQuestions.id, { onDelete: "restrict" }),
  submissionKey: text("submission_key").notNull(),
  submissionRequestHash: text("submission_request_hash").notNull(),
  content: text("content").notNull().default(""),
  status: text("status").notNull(),
  analysisJson: jsonb("analysis_json"),
  analysisRunId: uuid("analysis_run_id")
    .references((): AnyPgColumn => interviewAgentRuns.id, { onDelete: "set null" }),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("idx_interview_answers_question").on(table.questionId),
  uniqueIndex("idx_interview_answers_submission_key").on(table.interviewId, table.submissionKey),
  check("interview_answers_status_check", sql`${table.status} IN ('answered', 'skipped')`),
  check(
    "interview_answers_content_check",
    sql`(${table.status} = 'answered' AND length(btrim(${table.content})) > 0) OR (${table.status} = 'skipped' AND ${table.content} = '')`,
  ),
]);

export const interviewAgentRuns = pgTable("interview_agent_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  interviewId: uuid("interview_id")
    .notNull()
    .references(() => interviews.id, { onDelete: "cascade" }),
  currentAgentRunId: uuid("current_agent_run_id")
    .references(() => agentRuns.id, { onDelete: "set null" }),
  triggerType: text("trigger_type").notNull(),
  triggerKey: text("trigger_key").notNull(),
  triggerAnswerId: uuid("trigger_answer_id")
    .references(() => interviewAnswers.id, { onDelete: "restrict" }),
  status: text("status").notNull().default("queued"),
  attemptCount: integer("attempt_count").notNull().default(0),
  attemptGeneration: integer("attempt_generation").notNull().default(0),
  leaseOwner: text("lease_owner"),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  errorJson: jsonb("error_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("idx_interview_agent_runs_trigger").on(table.interviewId, table.triggerKey),
  uniqueIndex("idx_interview_agent_runs_current_agent_run")
    .on(table.currentAgentRunId)
    .where(sql`${table.currentAgentRunId} IS NOT NULL`),
  index("idx_interview_agent_runs_status_lease").on(table.status, table.leaseExpiresAt),
  check("interview_agent_runs_trigger_type_check", sql`${table.triggerType} IN ('opening', 'answer', 'skip')`),
  check(
    "interview_agent_runs_status_check",
    sql`${table.status} IN ('queued', 'running', 'completed', 'failed', 'cancelled')`,
  ),
  check("interview_agent_runs_attempt_count_check", sql`${table.attemptCount} >= 0`),
  check("interview_agent_runs_generation_check", sql`${table.attemptGeneration} >= 0`),
  check(
    "interview_agent_runs_trigger_answer_check",
    sql`(${table.triggerType} = 'opening' AND ${table.triggerAnswerId} IS NULL) OR (${table.triggerType} IN ('answer', 'skip') AND ${table.triggerAnswerId} IS NOT NULL)`,
  ),
]);

export const questionScores = pgTable("question_scores", {
  id: uuid("id").primaryKey().defaultRandom(),
  questionId: uuid("question_id")
    .notNull()
    .references(() => interviewQuestions.id, { onDelete: "cascade" }),
  understanding: integer("understanding"),
  expression: integer("expression"),
  logic: integer("logic"),
  depth: integer("depth"),
  authenticity: integer("authenticity"),
  reflection: integer("reflection"),
  overall: numeric("overall", { precision: 3, scale: 1 }),
  feedbackJson: jsonb("feedback_json"),
  status: text("status").notNull().default("pending"),
  attemptCount: integer("attempt_count").notNull().default(0),
  claimToken: text("claim_token"),
  claimExpiresAt: timestamp("claim_expires_at", { withTimezone: true }),
  errorJson: jsonb("error_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("idx_question_scores_question").on(table.questionId),
  check(
    "question_scores_status_check",
    sql`(${table.status} = 'pending' AND ${table.claimToken} IS NULL AND ${table.claimExpiresAt} IS NULL)
      OR (${table.status} = 'scoring' AND ${table.claimToken} IS NOT NULL AND ${table.claimExpiresAt} IS NOT NULL)
      OR (${table.status} = 'scored' AND ${table.claimToken} IS NULL AND ${table.claimExpiresAt} IS NULL
          AND ${table.understanding} IS NOT NULL AND ${table.expression} IS NOT NULL AND ${table.logic} IS NOT NULL
          AND ${table.depth} IS NOT NULL AND ${table.authenticity} IS NOT NULL AND ${table.reflection} IS NOT NULL
          AND ${table.overall} IS NOT NULL AND ${table.feedbackJson} IS NOT NULL)
      OR (${table.status} = 'failed' AND ${table.claimToken} IS NULL AND ${table.claimExpiresAt} IS NULL)`,
  ),
  check("question_scores_attempt_count_check", sql`${table.attemptCount} >= 0`),
  check("question_scores_overall_check", sql`${table.overall} IS NULL OR (${table.overall} >= 0.0 AND ${table.overall} <= 10.0)`),
  check(
    "question_scores_dimension_bounds_check",
    sql`(${table.understanding} IS NULL OR (${table.understanding} >= 0 AND ${table.understanding} <= 10))
      AND (${table.expression} IS NULL OR (${table.expression} >= 0 AND ${table.expression} <= 10))
      AND (${table.logic} IS NULL OR (${table.logic} >= 0 AND ${table.logic} <= 10))
      AND (${table.depth} IS NULL OR (${table.depth} >= 0 AND ${table.depth} <= 10))
      AND (${table.authenticity} IS NULL OR (${table.authenticity} >= 0 AND ${table.authenticity} <= 10))
      AND (${table.reflection} IS NULL OR (${table.reflection} >= 0 AND ${table.reflection} <= 10))`,
  ),
]);

export const interviewCompletionJobs = pgTable("interview_completion_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  interviewId: uuid("interview_id")
    .notNull()
    .references(() => interviews.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("pending"),
  attemptCount: integer("attempt_count").notNull().default(0),
  claimToken: text("claim_token"),
  claimExpiresAt: timestamp("claim_expires_at", { withTimezone: true }),
  errorJson: jsonb("error_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("idx_interview_completion_jobs_interview").on(table.interviewId),
  index("idx_interview_completion_jobs_status_claim").on(table.status, table.claimExpiresAt),
  check(
    "interview_completion_jobs_status_check",
    sql`(${table.status} IN ('scoring', 'reporting') AND ${table.claimToken} IS NOT NULL AND ${table.claimExpiresAt} IS NOT NULL)
      OR (${table.status} IN ('pending', 'failed') AND ${table.claimToken} IS NULL AND ${table.claimExpiresAt} IS NULL)
      OR (${table.status} = 'completed' AND ${table.claimToken} IS NULL AND ${table.claimExpiresAt} IS NULL AND ${table.completedAt} IS NOT NULL)`,
  ),
  check("interview_completion_jobs_attempt_count_check", sql`${table.attemptCount} >= 0`),
]);

export const interviewReports = pgTable("interview_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  interviewId: uuid("interview_id")
    .notNull()
    .references(() => interviews.id, { onDelete: "cascade" }),
  overallScore: integer("overall_score"),
  dimensionAveragesJson: jsonb("dimension_averages_json"),
  summaryJson: jsonb("summary_json").notNull(),
  scoreStatus: text("score_status").notNull(),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("idx_interview_reports_interview").on(table.interviewId),
  check("interview_reports_score_status_check", sql`${table.scoreStatus} IN ('scored', 'no_scorable_answers')`),
  check(
    "interview_reports_score_consistency_check",
    sql`(${table.scoreStatus} = 'scored' AND ${table.overallScore} IS NOT NULL AND ${table.overallScore} >= 0 AND ${table.overallScore} <= 100 AND ${table.dimensionAveragesJson} IS NOT NULL)
      OR (${table.scoreStatus} = 'no_scorable_answers' AND ${table.overallScore} IS NULL AND ${table.dimensionAveragesJson} IS NULL)`,
  ),
]);
