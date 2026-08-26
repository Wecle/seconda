import type { ParsedResume, ResumeSourceType } from "@/lib/resume/types";

export interface ResumeVersion {
  id: string;
  versionNumber: number;
  sourceType: ResumeSourceType;
  originalFilename: string | null;
  originalFileUrl: string | null;
  parseStatus: string;
  parseError?: string | null;
  parsedData: ParsedResume | null;
  createdAt: string;
}

export interface Resume {
  id: string;
  title: string;
  currentVersionId: string | null;
  createdAt: string;
  updatedAt: string;
  versions: ResumeVersion[];
}

export interface InterviewSummaryItem {
  id: string;
  resumeId: string;
  resumeVersionId: string;
  versionNumber: number;
  status: "initializing" | "active" | "completing" | "completed" | "failed";
  language: string;
  persona: string;
  interviewType: string;
  targetLevel: string;
  targetRole: string;
  preference: string;
  preferenceTags: string[];
  targetRoundCount: number;
  answeredRoundCount: number;
  overallScore: number | null;
  scoreStatus: string | null;
  completionJobStatus: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  durationSeconds: number;
}

