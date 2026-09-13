"use client";

import { useEffect, useRef } from "react";
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

interface InterviewParsedResumeViewProps {
  parsed: ParsedResume;
  activePaths: Set<string>;
  persistentPaths: Set<string>;
  isInherited?: boolean;
  className?: string;
}

export function InterviewParsedResumeView({
  parsed,
  activePaths,
  persistentPaths,
  className,
}: InterviewParsedResumeViewProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (activePaths.size === 0 || !containerRef.current) return;
    const timer = setTimeout(() => {
      const firstActive = containerRef.current?.querySelector('[data-active-fact="true"]');
      if (firstActive) {
        firstActive.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [activePaths]);

  const getPathStatus = (path: string) => {
    if (activePaths.has(path)) return "active" as const;
    if (persistentPaths.has(path)) return "persistent" as const;
    return "none" as const;
  };

  const getHighlightClass = (status: "active" | "persistent" | "none", type: "inline" | "block" = "block") => {
    if (status === "active") {
      return type === "inline"
        ? "bg-amber-400/25 ring-1.5 ring-amber-500/80 text-amber-950 dark:text-amber-200 font-semibold shadow-2xs"
        : "bg-amber-400/15 ring-1.5 ring-amber-500/70 dark:bg-amber-400/15 dark:ring-amber-400/80 rounded-xl p-2.5 -m-2.5 transition-all duration-300 shadow-2xs";
    }
    if (status === "persistent") {
      return type === "inline"
        ? "bg-primary/10 ring-1 ring-primary/30 text-primary font-medium"
        : "bg-primary/5 ring-1 ring-primary/20 rounded-xl p-2.5 -m-2.5 transition-all duration-300";
    }
    return "";
  };

  return (
    <div
      ref={containerRef}
      className={cn(
        "w-full space-y-7 rounded-2xl border border-border/70 bg-card p-6 sm:p-8 shadow-xs transition-colors",
        className,
      )}
    >
      {/* Header Profile Section */}
      <div className="border-b border-border/60 pb-6">
        <div className="flex flex-col gap-3.5 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl font-sans">
              {parsed.name}
            </h1>
            <p className="text-sm font-semibold text-primary">
              {parsed.title}
            </p>
            {parsed.summary && (
              <div
                data-active-fact={getPathStatus("summary") === "active" ? "true" : undefined}
                className={cn(
                  "mt-2.5 max-w-2xl border-l-2 border-primary/30 pl-3 py-0.5 text-xs leading-relaxed text-muted-foreground transition-all",
                  getHighlightClass(getPathStatus("summary"), "block"),
                )}
              >
                {parsed.summary}
              </div>
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
        <div className="space-y-2.5">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Code2 className="size-3.5 text-primary" />
            <span>{t.resume.skills}</span>
            <span className="font-mono text-[10px] text-muted-foreground/70">
              ({parsed.skills.length})
            </span>
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            {parsed.skills.map((skill, index) => {
              const status = getPathStatus(`skills[${index}]`);
              return (
                <span
                  key={skill}
                  data-active-fact={status === "active" ? "true" : undefined}
                  className={cn(
                    "rounded-lg px-2.5 py-1 text-xs font-medium transition-all",
                    status !== "none"
                      ? getHighlightClass(status, "inline")
                      : "bg-primary/8 text-primary border border-primary/15",
                  )}
                >
                  {skill}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Work Experience */}
      {parsed.experience.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Briefcase className="size-3.5 text-primary" />
            <span>{t.resume.experience}</span>
          </div>

          <div className="space-y-5 pt-1">
            {parsed.experience.map((job, i) => (
              <div key={i} className="relative pl-5">
                <div className="absolute left-0 top-1.5 size-2 rounded-full border-2 border-primary bg-background ring-2 ring-primary/10" />
                {i < parsed.experience.length - 1 && (
                  <div className="absolute left-[3.5px] top-4 h-[calc(100%+12px)] w-px bg-border/80" />
                )}

                <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-1">
                  <div>
                    <h3
                      data-active-fact={getPathStatus(`experience[${i}].title`) === "active" ? "true" : undefined}
                      className={cn(
                        "text-sm font-bold text-foreground transition-all",
                        getHighlightClass(getPathStatus(`experience[${i}].title`), "inline"),
                      )}
                    >
                      {job.title}
                    </h3>
                    <p
                      data-active-fact={getPathStatus(`experience[${i}].company`) === "active" ? "true" : undefined}
                      className={cn(
                        "text-xs font-medium text-primary transition-all",
                        getHighlightClass(getPathStatus(`experience[${i}].company`), "inline"),
                      )}
                    >
                      {job.company}
                    </p>
                  </div>
                  <span
                    data-active-fact={getPathStatus(`experience[${i}].period`) === "active" ? "true" : undefined}
                    className={cn(
                      "font-mono text-xs text-muted-foreground/80 transition-all",
                      getHighlightClass(getPathStatus(`experience[${i}].period`), "inline"),
                    )}
                  >
                    {job.period}
                  </span>
                </div>

                <ul className="mt-2 space-y-1.5">
                  {job.bullets.map((bullet, j) => {
                    const status = getPathStatus(`experience[${i}].bullets[${j}]`);
                    return (
                      <li
                        key={j}
                        data-active-fact={status === "active" ? "true" : undefined}
                        className={cn(
                          "text-xs leading-relaxed text-muted-foreground flex items-start gap-2 transition-all",
                          getHighlightClass(status, "block"),
                        )}
                      >
                        <span className="text-primary/60 font-bold select-none">•</span>
                        <span>{bullet}</span>
                      </li>
                    );
                  })}
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
              <div key={i} className="relative pl-5">
                <div className="absolute left-0 top-1.5 size-2 rounded-full border-2 border-primary bg-background ring-2 ring-primary/10" />
                {i < (parsed.education?.length ?? 0) - 1 && (
                  <div className="absolute left-[3.5px] top-4 h-[calc(100%+10px)] w-px bg-border/80" />
                )}

                <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <h3
                      data-active-fact={getPathStatus(`education[${i}].school`) === "active" ? "true" : undefined}
                      className={cn(
                        "text-sm font-bold text-foreground transition-all",
                        getHighlightClass(getPathStatus(`education[${i}].school`), "inline"),
                      )}
                    >
                      {edu.school}
                    </h3>
                    {(edu.major || edu.degree) && (
                      <span
                        data-active-fact={
                          getPathStatus(`education[${i}].major`) === "active" ||
                          getPathStatus(`education[${i}].degree`) === "active"
                            ? "true"
                            : undefined
                        }
                        className={cn(
                          "text-xs font-medium text-primary transition-all",
                          getHighlightClass(
                            getPathStatus(`education[${i}].major`) === "active" ||
                            getPathStatus(`education[${i}].degree`) === "active"
                              ? "active"
                              : getPathStatus(`education[${i}].major`) === "persistent" ||
                                getPathStatus(`education[${i}].degree`) === "persistent"
                              ? "persistent"
                              : "none",
                            "inline",
                          ),
                        )}
                      >
                        {[edu.major, edu.degree].filter(Boolean).join(" · ")}
                      </span>
                    )}
                  </div>
                  {edu.period && (
                    <span
                      data-active-fact={getPathStatus(`education[${i}].period`) === "active" ? "true" : undefined}
                      className={cn(
                        "shrink-0 font-mono text-xs text-muted-foreground/80 transition-all",
                        getHighlightClass(getPathStatus(`education[${i}].period`), "inline"),
                      )}
                    >
                      {edu.period}
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

          <div className="grid grid-cols-1 gap-3.5 pt-1">
            {parsed.projects.map((project, i) => {
              const projNameStatus = getPathStatus(`projects[${i}].name`);
              const projDescStatus = getPathStatus(`projects[${i}].description`);
              return (
                <div
                  key={project.name}
                  className="rounded-xl border border-border/70 bg-card/60 p-3.5 transition-all hover:border-primary/40"
                >
                  <div className="flex items-center justify-between gap-1.5">
                    <h3
                      data-active-fact={projNameStatus === "active" ? "true" : undefined}
                      className={cn(
                        "text-xs sm:text-sm font-bold text-foreground transition-all",
                        getHighlightClass(projNameStatus, "inline"),
                      )}
                    >
                      {project.name}
                    </h3>
                    <ExternalLink className="size-3 text-muted-foreground/60" />
                  </div>
                  <p
                    data-active-fact={projDescStatus === "active" ? "true" : undefined}
                    className={cn(
                      "mt-1.5 text-xs leading-relaxed text-muted-foreground transition-all",
                      getHighlightClass(projDescStatus, "block"),
                    )}
                  >
                    {project.description}
                  </p>
                  {project.bullets && project.bullets.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {project.bullets.map((bullet, k) => {
                        const bulletStatus = getPathStatus(`projects[${i}].bullets[${k}]`);
                        return (
                          <li
                            key={k}
                            data-active-fact={bulletStatus === "active" ? "true" : undefined}
                            className={cn(
                              "text-xs leading-relaxed text-muted-foreground flex items-start gap-1.5 transition-all",
                              getHighlightClass(bulletStatus, "block"),
                            )}
                          >
                            <span className="text-primary/60 select-none">•</span>
                            <span>{bullet}</span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {project.tags && project.tags.length > 0 && (
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {project.tags.map((tag, tagIndex) => {
                        const tagStatus = getPathStatus(`projects[${i}].tags[${tagIndex}]`);
                        return (
                          <span
                            key={tag}
                            data-active-fact={tagStatus === "active" ? "true" : undefined}
                            className={cn(
                              "rounded-md px-2 py-0.5 text-[10px] font-medium font-mono transition-all",
                              tagStatus !== "none"
                                ? getHighlightClass(tagStatus, "inline")
                                : "bg-secondary text-secondary-foreground",
                            )}
                          >
                            {tag}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
