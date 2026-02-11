"use client";

import { useState, useRef } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import type { ParsedResume } from "@/lib/resume/types";
import { useTranslation } from "@/lib/i18n/context";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

interface ParsedResumeEditorProps {
  parsed: ParsedResume;
  onSave: (data: ParsedResume) => Promise<void>;
  onCancel: () => void;
  saving: boolean;
}

export function ParsedResumeEditor({
  parsed,
  onSave,
  onCancel,
  saving,
}: ParsedResumeEditorProps) {
  const { t } = useTranslation();
  const [data, setData] = useState<ParsedResume>(() => structuredClone(parsed));
  const [addingSkill, setAddingSkill] = useState(false);
  const [newSkill, setNewSkill] = useState("");
  const skillInputRef = useRef<HTMLInputElement>(null);

  const updateField = <K extends keyof ParsedResume>(
    key: K,
    value: ParsedResume[K],
  ) => {
    setData((prev) => ({ ...prev, [key]: value }));
  };

  const updateContact = (field: string, value: string) => {
    setData((prev) => ({
      ...prev,
      contact: { ...prev.contact, [field]: value },
    }));
  };

  const removeSkill = (index: number) => {
    setData((prev) => ({
      ...prev,
      skills: prev.skills.filter((_, i) => i !== index),
    }));
  };

  const addSkill = () => {
    const trimmed = newSkill.trim();
    if (!trimmed) return;
    setData((prev) => ({ ...prev, skills: [...prev.skills, trimmed] }));
    setNewSkill("");
    setAddingSkill(false);
  };

  const updateExperience = (
    index: number,
    field: string,
    value: string | string[],
  ) => {
    setData((prev) => ({
      ...prev,
      experience: prev.experience.map((exp, i) =>
        i === index ? { ...exp, [field]: value } : exp,
      ),
    }));
  };

  const removeExperience = (index: number) => {
    setData((prev) => ({
      ...prev,
      experience: prev.experience.filter((_, i) => i !== index),
    }));
  };

  const addExperience = () => {
    setData((prev) => ({
      ...prev,
      experience: [
        ...prev.experience,
        { title: "", company: "", period: "", bullets: [""] },
      ],
    }));
  };

  const updateBullet = (expIndex: number, bulletIndex: number, value: string) => {
    setData((prev) => ({
      ...prev,
      experience: prev.experience.map((exp, i) =>
        i === expIndex
          ? {
              ...exp,
              bullets: exp.bullets.map((b, j) =>
                j === bulletIndex ? value : b,
              ),
            }
          : exp,
      ),
    }));
  };

  const removeBullet = (expIndex: number, bulletIndex: number) => {
    setData((prev) => ({
      ...prev,
      experience: prev.experience.map((exp, i) =>
        i === expIndex
          ? { ...exp, bullets: exp.bullets.filter((_, j) => j !== bulletIndex) }
          : exp,
      ),
    }));
  };

  const addBullet = (expIndex: number) => {
    setData((prev) => ({
      ...prev,
      experience: prev.experience.map((exp, i) =>
        i === expIndex ? { ...exp, bullets: [...exp.bullets, ""] } : exp,
      ),
    }));
  };

  const updateEducation = (index: number, field: string, value: string) => {
    setData((prev) => ({
      ...prev,
      education: (prev.education ?? []).map((edu, i) =>
        i === index ? { ...edu, [field]: value } : edu,
      ),
    }));
  };

  const removeEducation = (index: number) => {
    setData((prev) => ({
      ...prev,
      education: (prev.education ?? []).filter((_, i) => i !== index),
    }));
  };

  const addEducation = () => {
    setData((prev) => ({
      ...prev,
      education: [
        ...(prev.education ?? []),
        { major: "", degree: "", school: "", period: "" },
      ],
    }));
  };

  const updateProject = (
    index: number,
    field: string,
    value: string | string[],
  ) => {
    setData((prev) => ({
      ...prev,
      projects: (prev.projects ?? []).map((proj, i) =>
        i === index ? { ...proj, [field]: value } : proj,
      ),
    }));
  };

  const removeProject = (index: number) => {
    setData((prev) => ({
      ...prev,
      projects: (prev.projects ?? []).filter((_, i) => i !== index),
    }));
  };

  const addProject = () => {
    setData((prev) => ({
      ...prev,
      projects: [
        ...(prev.projects ?? []),
        { name: "", description: "", tags: [] },
      ],
    }));
  };

  const removeProjectTag = (projIndex: number, tagIndex: number) => {
    setData((prev) => ({
      ...prev,
      projects: (prev.projects ?? []).map((proj, i) =>
        i === projIndex
          ? { ...proj, tags: (proj.tags ?? []).filter((_, j) => j !== tagIndex) }
          : proj,
      ),
    }));
  };

  const addProjectTag = (projIndex: number, tag: string) => {
    const trimmed = tag.trim();
    if (!trimmed) return;
    setData((prev) => ({
      ...prev,
      projects: (prev.projects ?? []).map((proj, i) =>
        i === projIndex
          ? { ...proj, tags: [...(proj.tags ?? []), trimmed] }
          : proj,
      ),
    }));
  };

  return (
    <div className="w-full max-w-[850px] space-y-6 pb-20">
      <div className="rounded-xl border bg-card p-8">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                {t.resume.name}
              </label>
              <Input
                value={data.name}
                onChange={(e) => updateField("name", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                {t.resume.title}
              </label>
              <Input
                value={data.title}
                onChange={(e) => updateField("title", e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              {t.resume.summary}
            </label>
            <Textarea
              value={data.summary}
              onChange={(e) => updateField("summary", e.target.value)}
              className="min-h-20"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                {t.resume.email}
              </label>
              <Input
                value={data.contact?.email ?? ""}
                onChange={(e) => updateContact("email", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                {t.resume.phone}
              </label>
              <Input
                value={data.contact?.phone ?? ""}
                onChange={(e) => updateContact("phone", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                {t.resume.location}
              </label>
              <Input
                value={data.contact?.location ?? ""}
                onChange={(e) => updateContact("location", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                {t.resume.linkedin}
              </label>
              <Input
                value={data.contact?.linkedin ?? ""}
                onChange={(e) => updateContact("linkedin", e.target.value)}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border bg-card p-8">
        <h2 className="mb-4 text-base font-semibold">{t.resume.skills}</h2>
        <div className="flex flex-wrap gap-2">
          {data.skills.map((skill, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary"
            >
              {skill}
              <button
                type="button"
                onClick={() => removeSkill(i)}
                className="ml-0.5 rounded-sm p-0.5 hover:bg-primary/20"
              >
                <Trash2 className="size-3" />
              </button>
            </span>
          ))}
          {addingSkill ? (
            <Input
              ref={skillInputRef}
              value={newSkill}
              onChange={(e) => setNewSkill(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addSkill();
                }
                if (e.key === "Escape") {
                  setAddingSkill(false);
                  setNewSkill("");
                }
              }}
              onBlur={() => {
                addSkill();
                setAddingSkill(false);
              }}
              placeholder="New skill..."
              className="h-7 w-32 text-xs"
              autoFocus
            />
          ) : (
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => {
                setAddingSkill(true);
                setNewSkill("");
              }}
            >
              <Plus />
              {t.resume.addSkill}
            </Button>
          )}
        </div>
      </div>

      <div className="rounded-xl border bg-card p-8">
        <h2 className="mb-6 text-base font-semibold">{t.resume.experience}</h2>
        <div className="space-y-8">
          {data.experience.map((job, i) => (
            <div key={i} className="relative rounded-lg border bg-card p-5">
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="absolute right-3 top-3 text-muted-foreground hover:text-destructive"
                onClick={() => removeExperience(i)}
              >
                <Trash2 />
              </Button>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    {t.resume.jobTitle}
                  </label>
                  <Input
                    value={job.title}
                    onChange={(e) =>
                      updateExperience(i, "title", e.target.value)
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    {t.resume.company}
                  </label>
                  <Input
                    value={job.company}
                    onChange={(e) =>
                      updateExperience(i, "company", e.target.value)
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    {t.resume.period}
                  </label>
                  <Input
                    value={job.period}
                    onChange={(e) =>
                      updateExperience(i, "period", e.target.value)
                    }
                  />
                </div>
              </div>
              <div className="mt-4 space-y-2">
                <label className="text-xs font-medium text-muted-foreground">
                  {t.resume.bullets}
                </label>
                {job.bullets.map((bullet, j) => (
                  <div key={j} className="flex items-start gap-2">
                    <span className="mt-2.5 text-sm text-muted-foreground">
                      •
                    </span>
                    <Textarea
                      value={bullet}
                      onChange={(e) => updateBullet(i, j, e.target.value)}
                      className="min-h-9 flex-1"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="mt-1.5 text-muted-foreground hover:text-destructive"
                      onClick={() => removeBullet(i, j)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => addBullet(i)}
                  className="text-muted-foreground"
                >
                  <Plus />
                  {t.resume.addBullet}
                </Button>
              </div>
            </div>
          ))}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addExperience}
          className="mt-4"
        >
          <Plus />
          {t.resume.addExperience}
        </Button>
      </div>

      <div className="rounded-xl border bg-card p-8">
        <h2 className="mb-4 text-base font-semibold">{t.resume.education}</h2>
        <div className="space-y-4">
          {(data.education ?? []).map((edu, i) => (
            <div
              key={i}
              className="relative rounded-lg border bg-card p-5"
            >
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="absolute right-3 top-3 text-muted-foreground hover:text-destructive"
                onClick={() => removeEducation(i)}
              >
                <Trash2 />
              </Button>
              <div className="grid grid-cols-4 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    {t.resume.major}
                  </label>
                  <Input
                    value={edu.major ?? ""}
                    onChange={(e) =>
                      updateEducation(i, "major", e.target.value)
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    {t.resume.degree}
                  </label>
                  <Input
                    value={edu.degree}
                    onChange={(e) =>
                      updateEducation(i, "degree", e.target.value)
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    {t.resume.school}
                  </label>
                  <Input
                    value={edu.school}
                    onChange={(e) =>
                      updateEducation(i, "school", e.target.value)
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    {t.resume.period}
                  </label>
                  <Input
                    value={edu.period ?? ""}
                    onChange={(e) =>
                      updateEducation(i, "period", e.target.value)
                    }
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addEducation}
          className="mt-4"
        >
          <Plus />
          {t.resume.addEducation}
        </Button>
      </div>

      <div className="rounded-xl border bg-card p-8">
        <h2 className="mb-4 text-base font-semibold">{t.resume.projects}</h2>
        <div className="grid grid-cols-2 gap-4">
          {(data.projects ?? []).map((project, i) => (
            <div
              key={i}
              className="relative rounded-lg border bg-card p-5"
            >
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="absolute right-3 top-3 text-muted-foreground hover:text-destructive"
                onClick={() => removeProject(i)}
              >
                <Trash2 />
              </Button>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    {t.resume.projectName}
                  </label>
                  <Input
                    value={project.name}
                    onChange={(e) =>
                      updateProject(i, "name", e.target.value)
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    {t.resume.description}
                  </label>
                  <Textarea
                    value={project.description}
                    onChange={(e) =>
                      updateProject(i, "description", e.target.value)
                    }
                    className="min-h-16"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    {t.resume.tags}
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {(project.tags ?? []).map((tag, j) => (
                      <span
                        key={j}
                        className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium bg-secondary text-secondary-foreground"
                      >
                        {tag}
                        <button
                          type="button"
                          onClick={() => removeProjectTag(i, j)}
                          className="rounded-sm p-0.5 hover:bg-secondary-foreground/10"
                        >
                          <Trash2 className="size-2.5" />
                        </button>
                      </span>
                    ))}
                    <ProjectTagInput
                      addLabel={t.resume.addTag}
                      onAdd={(tag) => addProjectTag(i, tag)}
                    />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addProject}
          className="mt-4"
        >
          <Plus />
          {t.resume.addProject}
        </Button>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-50 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex max-w-[850px] items-center justify-end gap-3 px-8 py-3">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={saving}
          >
            {t.common.cancel}
          </Button>
          <Button
            type="button"
            onClick={() => onSave(data)}
            disabled={saving}
          >
            {saving ? (
              <>
                <Loader2 className="animate-spin" />
                {t.resume.saving}
              </>
            ) : (
              t.resume.saveChanges
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ProjectTagInput({
  addLabel,
  onAdd,
}: {
  addLabel: string;
  onAdd: (tag: string) => void;
}) {
  const [active, setActive] = useState(false);
  const [value, setValue] = useState("");

  if (!active) {
    return (
      <button
        type="button"
        onClick={() => setActive(true)}
        className="inline-flex items-center gap-0.5 rounded px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-secondary"
      >
        <Plus className="size-3" />
        {addLabel}
      </button>
    );
  }

  return (
    <Input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          if (value.trim()) {
            onAdd(value);
            setValue("");
          }
        }
        if (e.key === "Escape") {
          setActive(false);
          setValue("");
        }
      }}
      onBlur={() => {
        if (value.trim()) onAdd(value);
        setActive(false);
        setValue("");
      }}
      placeholder="Tag..."
      className="h-6 w-20 text-[11px]"
      autoFocus
    />
  );
}
