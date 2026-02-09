import { pgTable, text, integer, timestamp, uuid, jsonb, unique } from "drizzle-orm/pg-core";
import type { InterviewConfig } from "@/lib/interview/settings";

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
}, (table) => [
  unique().on(table.provider, table.providerAccountId),
]);

export const resumes = pgTable("resumes", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  currentVersionId: uuid("current_version_id"),
  interviewSettings: jsonb("interview_settings").$type<InterviewConfig>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const resumeVersions = pgTable("resume_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  resumeId: uuid("resume_id")
    .notNull()
    .references(() => resumes.id, { onDelete: "cascade" }),
  versionNumber: integer("version_number").notNull(),
  originalFilename: text("original_filename").notNull(),
  storedPath: text("stored_path").notNull(),
  mimeType: text("mime_type"),
  fileSize: integer("file_size"),
  extractedText: text("extracted_text"),
  parsedJson: jsonb("parsed_json"),
  parseStatus: text("parse_status").notNull().default("uploaded"),
  parseError: text("parse_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const interviews = pgTable("interviews", {
  id: uuid("id").primaryKey().defaultRandom(),
  resumeVersionId: uuid("resume_version_id")
    .notNull()
    .references(() => resumeVersions.id, { onDelete: "cascade" }),
  level: text("level").notNull(),
  type: text("type").notNull(),
  language: text("language").notNull(),
  questionCount: integer("question_count").notNull(),
  persona: text("persona").notNull(),
  status: text("status").notNull().default("active"),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  overallScore: integer("overall_score"),
  reportJson: jsonb("report_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const interviewQuestions = pgTable("interview_questions", {
  id: uuid("id").primaryKey().defaultRandom(),
  interviewId: uuid("interview_id")
    .notNull()
    .references(() => interviews.id, { onDelete: "cascade" }),
  questionIndex: integer("question_index").notNull(),
  questionType: text("question_type").notNull(),
  topic: text("topic"),
  question: text("question").notNull(),
  tip: text("tip"),
  askedAt: timestamp("asked_at", { withTimezone: true }).defaultNow(),
  answerText: text("answer_text"),
  answeredAt: timestamp("answered_at", { withTimezone: true }),
  feedbackJson: jsonb("feedback_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique().on(table.interviewId, table.questionIndex),
]);

export const questionScores = pgTable("question_scores", {
  id: uuid("id").primaryKey().defaultRandom(),
  questionId: uuid("question_id")
    .notNull()
    .unique()
    .references(() => interviewQuestions.id, { onDelete: "cascade" }),
  understanding: integer("understanding").notNull(),
  expression: integer("expression").notNull(),
  logic: integer("logic").notNull(),
  depth: integer("depth").notNull(),
  authenticity: integer("authenticity").notNull(),
  reflection: integer("reflection").notNull(),
  overall: integer("overall").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
