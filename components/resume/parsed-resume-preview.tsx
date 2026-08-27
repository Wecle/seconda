"use client";

import { Fragment, useMemo } from "react";
import {
  Briefcase,
  Code2,
  ExternalLink,
  GraduationCap,
  Link as LinkIcon,
  Mail,
  MapPin,
  Phone,
  Sparkles,
} from "lucide-react";
import type { ParsedResume } from "@/lib/resume/types";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n/context";

interface ParsedResumePreviewProps {
  parsed: ParsedResume;
  className?: string;
  highlightKeywords?: string[];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function ParsedResumePreview({
  parsed,
  className,
  highlightKeywords = [],
}: ParsedResumePreviewProps) {
  const { t } = useTranslation();
  const normalizedKeywords = useMemo(() => {
    return Array.from(
      new Set(
        highlightKeywords
          .map((token) => token.trim())
          .filter((token) => token.length >= 2),
      ),
    )
      .sort((a, b) => b.length - a.length)
      .slice(0, 80);
  }, [highlightKeywords]);

  const splitRegex = useMemo(() => {
    if (normalizedKeywords.length === 0) return null;
    const pattern = normalizedKeywords.map(escapeRegExp).join("|");
    return new RegExp(`(${pattern})`, "iu");
  }, [normalizedKeywords]);

  const countRegex = useMemo(() => {
    if (normalizedKeywords.length === 0) return null;
    const pattern = normalizedKeywords.map(escapeRegExp).join("|");
    return new RegExp(`(${pattern})`, "giu");
  }, [normalizedKeywords]);

  const highlightSet = useMemo(
    () => new Set(normalizedKeywords.map((token) => token.toLowerCase())),
    [normalizedKeywords],
  );

  const getMatchCount = (text: string): number => {
    if (!countRegex) return 0;
    return text.match(countRegex)?.length ?? 0;
  };

  const hasMatch = (text: string): boolean => getMatchCount(text) > 0;

  const renderText = (text: string) => {
    if (!splitRegex) return text;
    const parts = text.split(splitRegex);
    if (parts.length <= 1) return text;

    return parts.map((part, index) => {
      const isMatch = highlightSet.has(part.toLowerCase());
      return isMatch ? (
        <mark
          key={`${part}-${index}`}
          className="rounded-xs bg-amber-200/80 px-1 py-0.5 text-foreground font-medium"
        >
          {part}
        </mark>
      ) : (
        <Fragment key={`${part}-${index}`}>{part}</Fragment>
      );
    });
  };

  return (
    <div
      className={cn(
        "w-full max-w-[850px] space-y-8 rounded-2xl border border-border/70 bg-card p-8 md:p-10 shadow-xs",
        className,
      )}
    >
      {/* Header Profile Section */}
      <div className="border-b border-border/60 pb-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1.5">
            <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl font-sans">
              {parsed.name}
            </h1>
            <p className="text-base font-semibold text-primary">
              {parsed.title}
            </p>
            {parsed.summary && (
              <p className="mt-3 max-w-2xl border-l-2 border-primary/30 pl-3 py-0.5 text-xs sm:text-sm leading-relaxed text-muted-foreground">
                {renderText(parsed.summary)}
              </p>
            )}
          </div>

          {parsed.contact && (
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground sm:flex-col sm:items-end">
              {parsed.contact.email && (
                <span className="inline-flex items-center gap-1.5 rounded-md bg-muted/40 px-2 py-1">
                  <Mail className="size-3.5 text-primary" />
                  {parsed.contact.email}
                </span>
              )}
              {parsed.contact.phone && (
                <span className="inline-flex items-center gap-1.5 rounded-md bg-muted/40 px-2 py-1">
                  <Phone className="size-3.5 text-primary" />
                  {parsed.contact.phone}
                </span>
              )}
              {parsed.contact.location && (
                <span className="inline-flex items-center gap-1.5 rounded-md bg-muted/40 px-2 py-1">
                  <MapPin className="size-3.5 text-primary" />
                  {parsed.contact.location}
                </span>
              )}
              {parsed.contact.linkedin && (
                <span className="inline-flex items-center gap-1.5 rounded-md bg-muted/40 px-2 py-1">
                  <LinkIcon className="size-3.5 text-primary" />
                  {parsed.contact.linkedin}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Core Skills */}
      {parsed.skills.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Code2 className="size-3.5 text-primary" />
            <span>{t.resume.skills}</span>
            <span className="font-mono text-[10px] text-muted-foreground/70">
              ({parsed.skills.length})
            </span>
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            {parsed.skills.map((skill) => (
              <span
                key={skill}
                className={cn(
                  "rounded-lg px-2.5 py-1 text-xs font-medium transition-all",
                  hasMatch(skill)
                    ? "bg-amber-100 text-amber-900 ring-1 ring-amber-300 dark:bg-amber-950/60 dark:text-amber-300"
                    : "bg-primary/8 text-primary border border-primary/15 hover:bg-primary/15",
                )}
              >
                {renderText(skill)}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Work Experience */}
      {parsed.experience.length > 0 && (
        <div className="space-y-5">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Briefcase className="size-3.5 text-primary" />
            <span>{t.resume.experience}</span>
          </div>

          <div className="space-y-6 pt-1">
            {parsed.experience.map((job, i) => (
              <div key={i} className="relative pl-6">
                {/* Timeline node & line */}
                <div className="absolute left-0 top-1.5 size-2.5 rounded-full border-2 border-primary bg-background ring-3 ring-primary/10" />
                {i < parsed.experience.length - 1 && (
                  <div className="absolute left-[4.5px] top-4.5 h-[calc(100%+14px)] w-px bg-border/80" />
                )}

                <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-1">
                  <div>
                    <h3 className="text-sm font-bold text-foreground">
                      {renderText(job.title)}
                    </h3>
                    <p className="text-xs font-medium text-primary">
                      {renderText(job.company)}
                    </p>
                  </div>
                  <span className="font-mono text-xs text-muted-foreground/80">
                    {renderText(job.period)}
                  </span>
                </div>

                <ul className="mt-2.5 space-y-1.5">
                  {job.bullets.map((bullet, j) => (
                    <li
                      key={j}
                      className={cn(
                        "text-xs sm:text-sm leading-relaxed text-muted-foreground flex items-start gap-2",
                        hasMatch(bullet) && "bg-amber-50/80 dark:bg-amber-950/30 p-1 rounded-sm",
                      )}
                    >
                      <span className="text-primary/60 font-bold select-none">•</span>
                      <span>{renderText(bullet)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Education */}
      {parsed.education && parsed.education.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <GraduationCap className="size-3.5 text-primary" />
            <span>{t.resume.education}</span>
          </div>

          <div className="space-y-4 pt-1">
            {parsed.education.map((edu, i) => (
              <div key={i} className="relative pl-6">
                <div className="absolute left-0 top-1.5 size-2.5 rounded-full border-2 border-primary bg-background ring-3 ring-primary/10" />
                {i < (parsed.education?.length ?? 0) - 1 && (
                  <div className="absolute left-[4.5px] top-4.5 h-[calc(100%+10px)] w-px bg-border/80" />
                )}

                <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <h3 className="text-sm font-bold text-foreground">
                      {renderText(edu.school)}
                    </h3>
                    {(edu.major || edu.degree) && (
                      <span className="text-xs font-medium text-primary">
                        {[edu.major, edu.degree]
                          .filter(Boolean)
                          .map((s) => renderText(s!))
                          .reduce<React.ReactNode[]>((acc, node, idx) => {
                            if (idx > 0) acc.push(" · ");
                            acc.push(node);
                            return acc;
                          }, [])}
                      </span>
                    )}
                  </div>
                  {edu.period && (
                    <span className="shrink-0 font-mono text-xs text-muted-foreground/80">
                      {renderText(edu.period)}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Projects */}
      {parsed.projects && parsed.projects.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Sparkles className="size-3.5 text-primary" />
            <span>{t.resume.projects}</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
            {parsed.projects.map((project) => (
              <div
                key={project.name}
                className="rounded-xl border border-border/70 bg-card/60 p-4 transition-all hover:border-primary/40 hover:shadow-xs"
              >
                <div className="flex items-center justify-between gap-1.5">
                  <h3 className="text-xs sm:text-sm font-bold text-foreground">
                    {renderText(project.name)}
                  </h3>
                  <ExternalLink className="size-3 text-muted-foreground/60" />
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                  {renderText(project.description)}
                </p>
                {project.bullets && project.bullets.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {project.bullets.map((bullet, k) => (
                      <li
                        key={k}
                        className={cn(
                          "text-xs leading-relaxed text-muted-foreground flex items-start gap-1.5",
                          hasMatch(bullet) && "bg-amber-50/80 dark:bg-amber-950/30 px-1 py-0.5 rounded",
                        )}
                      >
                        <span className="text-primary/60 select-none">•</span>
                        <span>{renderText(bullet)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {project.tags && project.tags.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {project.tags.map((tag) => (
                      <span
                        key={tag}
                        className={cn(
                          "rounded-md px-2 py-0.5 text-[10px] font-medium font-mono",
                          hasMatch(tag)
                            ? "bg-amber-100 text-amber-800"
                            : "bg-secondary text-secondary-foreground",
                        )}
                      >
                        {renderText(tag)}
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

