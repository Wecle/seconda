import type { ParsedResume } from "@/lib/resume/types";
import type { InterviewConfig } from "@/lib/interview/settings";

export interface ResumeVersion {
  id: string;
  versionNumber: number;
  originalFilename: string;
  originalFileUrl?: string | null;
  parseStatus: string;
  parseError?: string | null;
  parsedData: ParsedResume | null;
  createdAt: string;
}

export interface Resume {
  id: string;
  title: string;
  currentVersionId: string | null;
  interviewSettings: InterviewConfig | null;
  createdAt: string;
  updatedAt: string;
  versions: ResumeVersion[];
}
