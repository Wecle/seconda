import { z } from "zod";

export const parsedResumeSchema = z.object({
  name: z.string().describe("Full name of the candidate"),
  title: z.string().describe("Professional title or current role"),
  summary: z.string().optional().describe("Professional summary or bio"),
  contact: z.object({
    email: z.string().optional(),
    phone: z.string().optional(),
    location: z.string().optional(),
    linkedin: z.string().optional(),
    website: z.string().optional(),
  }).optional(),
  skills: z.array(z.string()).describe("List of technical and soft skills"),
  experience: z.array(z.object({
    title: z.string().describe("Job title"),
    company: z.string().describe("Company name"),
    period: z.string().describe("Employment period"),
    bullets: z.array(z.string()).describe("Key responsibilities and achievements"),
  })).describe("Work experience entries"),
  education: z.array(z.object({
    degree: z.string(),
    school: z.string(),
    period: z.string().optional(),
  })).optional().describe("Education entries"),
  projects: z.array(z.object({
    name: z.string(),
    description: z.string(),
    tags: z.array(z.string()).optional(),
  })).optional().describe("Notable projects"),
});

export type ParsedResume = z.infer<typeof parsedResumeSchema>;
