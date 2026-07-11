import type { ParsedResume } from "@/lib/resume/types";
import type { StoredInterviewConfig } from "@/lib/interview/settings";

export interface VersionInterview {
  id: string;
  status: string;
  type: string;
  level: string;
  overallScore: number | null;
  questionCount: number;
  configVersion: number;
  targetRole: string | null;
  candidateRoundCount: number;
  createdAt: string;
  completedAt: string | null;
}

export interface ResumeVersion {
  id: string;
  versionNumber: number;
  originalFilename: string;
  originalFileUrl?: string | null;
  parseStatus: string;
  parseError?: string | null;
  parsedData: ParsedResume | null;
  createdAt: string;
  interviews: VersionInterview[];
}

export interface Resume {
  id: string;
  title: string;
  currentVersionId: string | null;
  interviewSettings: StoredInterviewConfig | null;
  createdAt: string;
  updatedAt: string;
  versions: ResumeVersion[];
}
