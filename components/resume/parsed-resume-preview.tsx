"use client";

import {
  ExternalLink,
  Link as LinkIcon,
  Mail,
  MapPin,
  Phone,
} from "lucide-react";
import type { ParsedResume } from "@/lib/resume/types";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n/context";

interface ParsedResumePreviewProps {
  parsed: ParsedResume;
  className?: string;
}

export function ParsedResumePreview({
  parsed,
  className,
}: ParsedResumePreviewProps) {
  const { t } = useTranslation();
  return (
    <div className={cn("w-full max-w-[850px] space-y-6", className)}>
      <div className="rounded-xl border bg-card p-8">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold">{parsed.name}</h1>
            <p className="mt-1 text-lg font-medium text-primary">
              {parsed.title}
            </p>
            {parsed.summary && (
              <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted-foreground">
                {parsed.summary}
              </p>
            )}
          </div>
          {parsed.contact && (
            <div className="flex flex-col items-end gap-1.5 text-sm text-muted-foreground">
              {parsed.contact.email && (
                <span className="inline-flex items-center gap-1.5">
                  <Mail className="size-3.5" />
                  {parsed.contact.email}
                </span>
              )}
              {parsed.contact.phone && (
                <span className="inline-flex items-center gap-1.5">
                  <Phone className="size-3.5" />
                  {parsed.contact.phone}
                </span>
              )}
              {parsed.contact.location && (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="size-3.5" />
                  {parsed.contact.location}
                </span>
              )}
              {parsed.contact.linkedin && (
                <span className="inline-flex items-center gap-1.5">
                  <LinkIcon className="size-3.5" />
                  {parsed.contact.linkedin}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {parsed.skills.length > 0 && (
        <div className="rounded-xl border bg-card p-8">
          <h2 className="mb-4 text-base font-semibold">{t.resume.skills}</h2>
          <div className="flex flex-wrap gap-2">
            {parsed.skills.map((skill) => (
              <span
                key={skill}
                className="rounded-md bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary"
              >
                {skill}
              </span>
            ))}
          </div>
        </div>
      )}

      {parsed.experience.length > 0 && (
        <div className="rounded-xl border bg-card p-8">
          <h2 className="mb-6 text-base font-semibold">{t.resume.experience}</h2>
          <div className="space-y-8">
            {parsed.experience.map((job, i) => (
              <div key={i} className="relative pl-6">
                <div className="absolute left-0 top-1.5 size-2.5 rounded-full bg-primary" />
                {i < parsed.experience.length - 1 && (
                  <div className="absolute left-[4.5px] top-4 h-[calc(100%+16px)] w-px bg-border" />
                )}
                <div className="flex items-baseline justify-between">
                  <div>
                    <h3 className="text-sm font-semibold">{job.title}</h3>
                    <p className="text-sm text-primary">{job.company}</p>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {job.period}
                  </span>
                </div>
                <ul className="mt-2 space-y-1.5">
                  {job.bullets.map((bullet, j) => (
                    <li
                      key={j}
                      className="text-sm leading-relaxed text-muted-foreground"
                    >
                      • {bullet}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

      {parsed.education && parsed.education.length > 0 && (
        <div className="rounded-xl border bg-card p-8">
          <h2 className="mb-4 text-base font-semibold">{t.resume.education}</h2>
          <div className="space-y-4">
            {parsed.education.map((edu, i) => (
              <div key={i}>
                <h3 className="text-sm font-semibold">{edu.degree}</h3>
                <p className="text-sm text-primary">{edu.school}</p>
                {edu.period && (
                  <p className="text-xs text-muted-foreground">{edu.period}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {parsed.projects && parsed.projects.length > 0 && (
        <div className="rounded-xl border bg-card p-8">
          <h2 className="mb-4 text-base font-semibold">{t.resume.projects}</h2>
          <div className="grid grid-cols-2 gap-4">
            {parsed.projects.map((project) => (
              <div
                key={project.name}
                className="rounded-lg border bg-background p-5"
              >
                <div className="flex items-center gap-1.5">
                  <h3 className="text-sm font-semibold">{project.name}</h3>
                  <ExternalLink className="size-3.5 text-muted-foreground" />
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                  {project.description}
                </p>
                {project.tags && project.tags.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {project.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
