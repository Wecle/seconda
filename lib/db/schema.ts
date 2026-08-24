import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  integer,
  jsonb,
  pgTable,
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
