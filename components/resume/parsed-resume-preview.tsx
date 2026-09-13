"use client";

import { Fragment, useMemo, useRef, useEffect } from "react";
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

export interface ParsedResumePreviewProps {
  parsed: ParsedResume;
  className?: string;
  highlightKeywords?: string[];
  activePaths?: Set<string>;
  persistentPaths?: Set<string>;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function ParsedResumePreview({
  parsed,
  className,
  highlightKeywords = [],
  activePaths,
  persistentPaths,
}: ParsedResumePreviewProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const lastActivePathsRef = useRef<string>("");

  useEffect(() => {
    if (!activePaths || activePaths.size === 0 || !containerRef.current) return;
    const serialized = Array.from(activePaths).sort().join(",");
    if (serialized === lastActivePathsRef.current) return;
    lastActivePathsRef.current = serialized;

    const timer = setTimeout(() => {
      const firstActive = containerRef.current?.querySelector('[data-active-fact="true"]');
      if (firstActive) {
        firstActive.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }, 120);
    return () => clearTimeout(timer);
  }, [activePaths]);

  const getPathStatus = (path: string): "active" | "persistent" | "none" => {
    if (activePaths?.has(path)) return "active";
    if (persistentPaths?.has(path)) return "persistent";
    return "none";
  };
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

  const isInterviewMode = Boolean(activePaths || persistentPaths);

  return (
    <div
      ref={containerRef}
      className={cn(
        "w-full max-w-[850px] space-y-8 rounded-2xl border border-border/70 bg-card p-6 sm:p-8 md:p-10 shadow-xs transition-colors",
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
              <p
                data-active-fact={getPathStatus("summary") === "active" ? "true" : undefined}
                className={cn(
                  "mt-3 max-w-2xl border-l-2 pl-3 py-1 text-xs sm:text-sm leading-relaxed text-muted-foreground transition-all duration-200 rounded-r-md",
                  getPathStatus("summary") === "active"
                    ? "border-l-amber-500 bg-amber-100/70 text-foreground font-medium dark:bg-amber-950/40 dark:text-amber-100"
                    : getPathStatus("summary") === "persistent"
                      ? "border-l-sky-500 bg-sky-50/70 text-foreground dark:bg-sky-950/30 dark:text-sky-100"
                      : "border-primary/30",
                )}
              >
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
            {parsed.skills.map((skill, index) => {
              const status = getPathStatus(`skills[${index}]`);
              const matched = hasMatch(skill);
              return (
                <span
                  key={skill}
                  data-active-fact={status === "active" ? "true" : undefined}
                  className={cn(
                    "rounded-lg px-2.5 py-1 text-xs font-medium transition-all duration-200",
                    status === "active" || matched
                      ? "bg-amber-100 text-amber-950 ring-1.5 ring-amber-400 dark:bg-amber-950/70 dark:text-amber-200 dark:ring-amber-500 shadow-2xs font-semibold"
                      : status === "persistent"
                        ? "bg-sky-100/80 text-sky-900 ring-1 ring-sky-300 dark:bg-sky-950/60 dark:text-sky-200 dark:ring-sky-700 font-medium"
                        : isInterviewMode
                          ? "bg-muted/40 text-muted-foreground border border-border/60 hover:bg-muted/60 hover:text-foreground"
                          : "bg-primary/8 text-primary border border-primary/15 hover:bg-primary/15",
                  )}
                >
                  {renderText(skill)}
                </span>
              );
            })}
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
            {parsed.experience.map((job, i) => {
              const titleStatus = getPathStatus(`experience[${i}].title`);
              const companyStatus = getPathStatus(`experience[${i}].company`);
              const periodStatus = getPathStatus(`experience[${i}].period`);
              return (
                <div key={i} className="relative pl-6">
                  {/* Timeline node & line */}
                  <div className="absolute left-0 top-1.5 size-2.5 rounded-full border-2 border-primary bg-background ring-3 ring-primary/10" />
                  {i < parsed.experience.length - 1 && (
                    <div className="absolute left-[4.5px] top-4.5 h-[calc(100%+14px)] w-px bg-border/80" />
                  )}

                  <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-1">
                    <div>
                      <h3
                        data-active-fact={titleStatus === "active" ? "true" : undefined}
                        className={cn(
                          "text-sm font-bold text-foreground transition-all duration-200 rounded-sm inline-block",
                          titleStatus === "active" &&
                            "bg-amber-200/80 dark:bg-amber-900/60 text-amber-950 dark:text-amber-100 px-1.5 py-0.5 ring-1 ring-amber-400",
                          titleStatus === "persistent" &&
                            "bg-sky-100/80 dark:bg-sky-950/60 text-sky-950 dark:text-sky-200 px-1.5 py-0.5 ring-1 ring-sky-300",
                        )}
                      >
                        {renderText(job.title)}
                      </h3>
                      <p
                        data-active-fact={companyStatus === "active" ? "true" : undefined}
                        className={cn(
                          "text-xs font-medium transition-all duration-200 rounded-sm inline-block ml-0 sm:ml-1.5",
                          companyStatus === "active"
                            ? "bg-amber-200/80 dark:bg-amber-900/60 text-amber-950 dark:text-amber-100 px-1.5 py-0.5 ring-1 ring-amber-400"
                            : companyStatus === "persistent"
                              ? "bg-sky-100/80 dark:bg-sky-950/60 text-sky-950 dark:text-sky-200 px-1.5 py-0.5 ring-1 ring-sky-300"
                              : "text-primary",
                        )}
                      >
                        {renderText(job.company)}
                      </p>
                    </div>
                    <span
                      data-active-fact={periodStatus === "active" ? "true" : undefined}
                      className={cn(
                        "font-mono text-xs text-muted-foreground/80 transition-all duration-200 rounded-sm",
                        periodStatus === "active" &&
                          "bg-amber-200/80 dark:bg-amber-900/60 text-amber-950 px-1.5 py-0.5 ring-1 ring-amber-400",
                        periodStatus === "persistent" &&
                          "bg-sky-100/80 dark:bg-sky-950/60 text-sky-900 px-1.5 py-0.5 ring-1 ring-sky-300",
                      )}
                    >
                      {renderText(job.period)}
                    </span>
                  </div>

                  <ul className="mt-2.5 space-y-1.5">
                    {job.bullets.map((bullet, j) => {
                      const bulletStatus = getPathStatus(`experience[${i}].bullets[${j}]`);
                      const isBulletActive = bulletStatus === "active";
                      const isBulletPersistent = bulletStatus === "persistent";
                      const isMatch = hasMatch(bullet);
                      return (
                        <li
                          key={j}
                          data-active-fact={isBulletActive ? "true" : undefined}
                          className={cn(
                            "text-xs sm:text-sm leading-relaxed text-muted-foreground flex items-start gap-2 rounded-md p-1 transition-all duration-200",
                            (isBulletActive || isMatch) && "bg-amber-100/70 dark:bg-amber-950/40 text-foreground ring-1 ring-amber-400/60",
                            !isBulletActive && !isMatch && isBulletPersistent && "bg-sky-50/70 dark:bg-sky-950/30 text-foreground ring-1 ring-sky-200/60",
                          )}
                        >
                          <span className={cn(
                            "font-bold select-none",
                            isBulletActive ? "text-amber-600" : isBulletPersistent ? "text-sky-600" : "text-primary/60"
                          )}>•</span>
                          <span>{renderText(bullet)}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
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
            {parsed.education.map((edu, i) => {
              const schoolStatus = getPathStatus(`education[${i}].school`);
              const majorStatus = getPathStatus(`education[${i}].major`);
              const degreeStatus = getPathStatus(`education[${i}].degree`);
              const periodStatus = getPathStatus(`education[${i}].period`);
              const majorDegreeActive = majorStatus === "active" || degreeStatus === "active";
              const majorDegreePersistent = majorStatus === "persistent" || degreeStatus === "persistent";
              return (
                <div key={i} className="relative pl-6">
                  <div className="absolute left-0 top-1.5 size-2.5 rounded-full border-2 border-primary bg-background ring-3 ring-primary/10" />
                  {i < (parsed.education?.length ?? 0) - 1 && (
                    <div className="absolute left-[4.5px] top-4.5 h-[calc(100%+10px)] w-px bg-border/80" />
                  )}

                  <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-1">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <h3
                        data-active-fact={schoolStatus === "active" ? "true" : undefined}
                        className={cn(
                          "text-sm font-bold text-foreground transition-all duration-200 rounded-sm",
                          schoolStatus === "active" &&
                            "bg-amber-200/80 dark:bg-amber-900/60 text-amber-950 dark:text-amber-100 px-1.5 py-0.5 ring-1 ring-amber-400",
                          schoolStatus === "persistent" &&
                            "bg-sky-100/80 dark:bg-sky-950/60 text-sky-950 dark:text-sky-200 px-1.5 py-0.5 ring-1 ring-sky-300",
                        )}
                      >
                        {renderText(edu.school)}
                      </h3>
                      {(edu.major || edu.degree) && (
                        <span
                          data-active-fact={majorDegreeActive ? "true" : undefined}
                          className={cn(
                            "text-xs font-medium transition-all duration-200 rounded-sm",
                            majorDegreeActive
                              ? "bg-amber-200/80 dark:bg-amber-900/60 text-amber-950 dark:text-amber-100 px-1.5 py-0.5 ring-1 ring-amber-400"
                              : majorDegreePersistent
                                ? "bg-sky-100/80 dark:bg-sky-950/60 text-sky-950 dark:text-sky-200 px-1.5 py-0.5 ring-1 ring-sky-300"
                                : "text-primary",
                          )}
                        >
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
                      <span
                        data-active-fact={periodStatus === "active" ? "true" : undefined}
                        className={cn(
                          "shrink-0 font-mono text-xs text-muted-foreground/80 transition-all duration-200 rounded-sm",
                          periodStatus === "active" &&
                            "bg-amber-200/80 dark:bg-amber-900/60 text-amber-950 px-1.5 py-0.5 ring-1 ring-amber-400",
                          periodStatus === "persistent" &&
                            "bg-sky-100/80 dark:bg-sky-950/60 text-sky-900 px-1.5 py-0.5 ring-1 ring-sky-300",
                        )}
                      >
                        {renderText(edu.period)}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
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
            {parsed.projects.map((project, i) => {
              const nameStatus = getPathStatus(`projects[${i}].name`);
              const descStatus = getPathStatus(`projects[${i}].description`);
              const isProjActive = nameStatus === "active" || descStatus === "active";
              const isProjPersistent = nameStatus === "persistent" || descStatus === "persistent";
              return (
                <div
                  key={project.name}
                  className={cn(
                    "rounded-xl border bg-card/60 p-4 transition-all duration-200 hover:border-primary/40 hover:shadow-xs",
                    isProjActive
                      ? "border-amber-400 bg-amber-50/20 dark:bg-amber-950/20 ring-1 ring-amber-400/60 shadow-xs"
                      : isProjPersistent
                        ? "border-sky-300 bg-sky-50/15 dark:bg-sky-950/10 ring-1 ring-sky-200/60"
                        : "border-border/70",
                  )}
                >
                  <div className="flex items-center justify-between gap-1.5">
                    <h3
                      data-active-fact={nameStatus === "active" ? "true" : undefined}
                      className={cn(
                        "text-xs sm:text-sm font-bold text-foreground transition-colors",
                        nameStatus === "active" && "text-amber-950 dark:text-amber-200",
                        nameStatus === "persistent" && "text-sky-950 dark:text-sky-200",
                      )}
                    >
                      {renderText(project.name)}
                    </h3>
                    <ExternalLink className="size-3 text-muted-foreground/60" />
                  </div>
                  <p
                    data-active-fact={descStatus === "active" ? "true" : undefined}
                    className={cn(
                      "mt-1.5 text-xs leading-relaxed text-muted-foreground rounded-md transition-colors",
                      descStatus === "active" && "bg-amber-100/70 dark:bg-amber-950/40 text-foreground p-1 ring-1 ring-amber-400/60",
                      descStatus === "persistent" && "bg-sky-50/80 dark:bg-sky-950/30 text-foreground p-1 ring-1 ring-sky-200/60",
                    )}
                  >
                    {renderText(project.description)}
                  </p>
                  {project.bullets && project.bullets.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {project.bullets.map((bullet, k) => {
                        const bulletStatus = getPathStatus(`projects[${i}].bullets[${k}]`);
                        const isBulletActive = bulletStatus === "active";
                        const isBulletPersistent = bulletStatus === "persistent";
                        return (
                          <li
                            key={k}
                            data-active-fact={isBulletActive ? "true" : undefined}
                            className={cn(
                              "text-xs leading-relaxed text-muted-foreground flex items-start gap-1.5 rounded-sm p-0.5 transition-colors",
                              isBulletActive && "bg-amber-100/70 dark:bg-amber-950/40 text-foreground ring-1 ring-amber-400/60",
                              !isBulletActive && isBulletPersistent && "bg-sky-50/80 dark:bg-sky-950/30 text-foreground ring-1 ring-sky-200/60",
                              hasMatch(bullet) && "bg-amber-50/80 dark:bg-amber-950/30 px-1 py-0.5 rounded",
                            )}
                          >
                            <span className={cn(
                              "select-none",
                              isBulletActive ? "text-amber-600" : isBulletPersistent ? "text-sky-600" : "text-primary/60",
                            )}>•</span>
                            <span>{renderText(bullet)}</span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {project.tags && project.tags.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {project.tags.map((tag, tagIndex) => {
                        const tagStatus = getPathStatus(`projects[${i}].tags[${tagIndex}]`);
                        const isTagActive = tagStatus === "active";
                        const isTagPersistent = tagStatus === "persistent";
                        return (
                          <span
                            key={tag}
                            data-active-fact={isTagActive ? "true" : undefined}
                            className={cn(
                              "rounded-md px-2 py-0.5 text-[10px] font-medium font-mono transition-all",
                              isTagActive || hasMatch(tag)
                                ? "bg-amber-100 text-amber-900 ring-1 ring-amber-300 dark:bg-amber-950/60 dark:text-amber-300 font-semibold"
                                : isTagPersistent
                                  ? "bg-sky-100 text-sky-900 ring-1 ring-sky-300 dark:bg-sky-950/60 dark:text-sky-300"
                                  : "bg-secondary text-secondary-foreground",
                            )}
                          >
                            {renderText(tag)}
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

