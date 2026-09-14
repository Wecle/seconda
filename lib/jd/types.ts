import { z } from "zod";

export const parsedJobDescriptionSchema = z.object({
  roleTitle: z.string().trim().min(1).max(100),
  company: z.string().trim().max(100).optional(),
  departmentOrTeam: z.string().trim().max(100).optional(),
  experienceLevel: z.enum(["Junior", "Mid", "Senior"]).default("Mid"),
  coreResponsibilities: z.array(z.string().trim().min(1).max(300)).min(1).max(10),
  mustHaveSkills: z.array(z.string().trim().min(1).max(200)).min(1).max(12),
  niceToHaveSkills: z.array(z.string().trim().min(1).max(200)).max(8).default([]),
  competencyKeywords: z.array(z.string().trim().min(1).max(50)).min(1).max(10),
  decodingInsights: z.object({
    verbAutonomyLevel: z.enum(["lead_own", "execute", "support"]),
    betweenTheLines: z.array(z.string().trim().min(1).max(300)).max(5),
    reverseQuestions: z.array(z.string().trim().min(1).max(300)).min(1).max(4),
  }),
});

export type ParsedJobDescription = z.infer<typeof parsedJobDescriptionSchema>;

export type ResumeJobDescriptionItem = {
  id: string;
  resumeId: string;
  userId: string;
  title: string;
  company: string | null;
  sourceType: string;
  originalFilename: string | null;
  storedPath: string | null;
  fileSize: number | null;
  rawText: string;
  parsedJson: ParsedJobDescription;
  parseStatus: string;
  parseError: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export type InterviewJobSnapshotResponse = {
  id: string;
  interviewId: string;
  jobDescriptionId: string | null;
  title: string;
  company: string | null;
  sourceType: string;
  rawText: string;
  parsedJson: ParsedJobDescription;
  canonicalText: string;
  contentHash: string;
  createdAt: Date | string;
};
