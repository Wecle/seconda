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
