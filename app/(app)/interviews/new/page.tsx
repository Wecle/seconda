"use client"

import { useState, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  X,
  Brain,
  Code,
  Merge,
  Globe,
  Smile,
  Gavel,
  Timer,
  Check,
  Loader2,
} from "lucide-react"

const levels = ["Junior", "Mid", "Senior"] as const
type Level = (typeof levels)[number]

const interviewTypes = [
  { id: "behavioral", label: "Behavioral", icon: Brain, color: "bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400" },
  { id: "technical", label: "Technical", icon: Code, color: "bg-purple-100 text-purple-600 dark:bg-purple-900/40 dark:text-purple-400" },
  { id: "mixed", label: "Mixed", icon: Merge, color: "bg-teal-100 text-teal-600 dark:bg-teal-900/40 dark:text-teal-400" },
] as const

const personas = [
  {
    id: "friendly",
    label: "Friendly",
    description: "Warm and encouraging, helps you feel comfortable.",
    icon: Smile,
    color: "bg-green-100 text-green-600 dark:bg-green-900/40 dark:text-green-400",
  },
  {
    id: "standard",
    label: "Standard",
    description: "Professional and balanced, mirrors real interviews.",
    icon: Gavel,
    color: "bg-slate-100 text-slate-600 dark:bg-slate-800/60 dark:text-slate-400",
  },
  {
    id: "stressful",
    label: "Stressful",
    description: "High-pressure, tests how you handle tough questions.",
    icon: Timer,
    color: "bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400",
  },
] as const

const sliderSteps = [5, 10, 15, 20, 25, 30]

function NewInterviewForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const resumeVersionId = searchParams.get("resumeVersionId")
  const [level, setLevel] = useState<Level>("Mid")
  const [type, setType] = useState("technical")
  const [language, setLanguage] = useState("en")
  const [questionCount, setQuestionCount] = useState(15)
  const [persona, setPersona] = useState("standard")
  const [loading, setLoading] = useState(false)

  async function handleCreate() {
    if (!resumeVersionId) return
    setLoading(true)
    try {
      const res = await fetch("/api/interviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          level: level.toLowerCase(),
          type,
          language,
          questionCount,
          persona,
          resumeVersionId,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      router.push(`/interviews/${data.interviewId}/room`)
    } catch (e) {
      console.error(e)
      setLoading(false)
    }
  }

  return (
    <div className="relative min-h-screen bg-background">
      {/* Blurred background – faux dashboard */}
      <div className="pointer-events-none select-none opacity-50 blur-[6px]" aria-hidden>
        <header className="border-b bg-card px-6 py-3">
          <div className="mx-auto flex max-w-6xl items-center justify-between">
            <div className="flex items-center gap-8">
              <span className="text-lg font-semibold tracking-tight">Seconda</span>
              <nav className="flex gap-5 text-sm text-muted-foreground">
                <span>Dashboard</span>
                <span>History</span>
                <span>Profile</span>
              </nav>
            </div>
            <Avatar size="sm">
              <AvatarFallback>A</AvatarFallback>
            </Avatar>
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-6 py-10">
          <h1 className="mb-6 text-2xl font-semibold">Welcome back, Alex</h1>
          <div className="grid grid-cols-3 gap-5">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-36 rounded-xl bg-card border" />
            ))}
          </div>
        </main>
      </div>

      {/* Modal overlay */}
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
        <div className="flex max-h-[90vh] w-full max-w-[680px] flex-col rounded-2xl bg-card shadow-2xl">
          {/* Header */}
          <div className="flex items-start justify-between border-b px-6 py-5">
            <div>
              <h2 className="text-lg font-semibold">New Interview Setup</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Configure your AI mock interview session parameters.
              </p>
            </div>
            <Button variant="ghost" size="icon-sm" className="mt-0.5 shrink-0" onClick={() => router.push("/dashboard")}>
              <X className="size-4" />
            </Button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-6 py-6 space-y-8">
            {/* 1. Target Level */}
            <section className="space-y-3">
              <Label className="text-muted-foreground">Target Level</Label>
              <div className="inline-flex rounded-lg bg-muted p-1">
                {levels.map((l) => (
                  <label key={l} className="cursor-pointer">
                    <input
                      type="radio"
                      name="level"
                      value={l}
                      checked={level === l}
                      onChange={() => setLevel(l)}
                      className="sr-only peer"
                    />
                    <span
                      className={cn(
                        "inline-flex items-center rounded-md px-4 py-1.5 text-sm font-medium transition-all",
                        "peer-checked:bg-card peer-checked:shadow-sm",
                        level !== l && "text-muted-foreground"
                      )}
                    >
                      {l}
                    </span>
                  </label>
                ))}
              </div>
            </section>

            {/* 2. Interview Type */}
            <section className="space-y-3">
              <Label className="text-muted-foreground">Interview Type</Label>
              <div className="grid grid-cols-3 gap-3">
                {interviewTypes.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setType(t.id)}
                    className={cn(
                      "flex flex-col items-center gap-2.5 rounded-xl border bg-card p-4 transition-all hover:shadow-sm",
                      type === t.id
                        ? "border-primary ring-1 ring-primary/20"
                        : "border-border"
                    )}
                  >
                    <div className={cn("flex size-10 items-center justify-center rounded-full", t.color)}>
                      <t.icon className="size-5" />
                    </div>
                    <span className="text-sm font-medium">{t.label}</span>
                  </button>
                ))}
              </div>
            </section>

            {/* 3. Language & Question Count */}
            <section className="grid grid-cols-2 gap-5">
              <div className="space-y-2">
                <Label className="text-muted-foreground">Language</Label>
                <Select value={language} onValueChange={setLanguage}>
                  <SelectTrigger className="w-full">
                    <SelectValue>
                      <Globe className="size-4 text-muted-foreground" />
                      {language === "en"
                        ? "English"
                        : language === "zh"
                          ? "Chinese"
                          : language === "es"
                            ? "Spanish"
                            : "German"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="en">English</SelectItem>
                    <SelectItem value="zh">Chinese</SelectItem>
                    <SelectItem value="es">Spanish</SelectItem>
                    <SelectItem value="de">German</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-muted-foreground">Question Count</Label>
                  <Badge variant="secondary" className="tabular-nums">
                    {questionCount} Questions
                  </Badge>
                </div>
                <Slider
                  min={5}
                  max={30}
                  step={1}
                  value={[questionCount]}
                  onValueChange={([v]) => setQuestionCount(v)}
                  className="mt-2"
                />
                <div className="flex justify-between px-0.5 mt-1">
                  {sliderSteps.map((s) => (
                    <span key={s} className="text-[10px] text-muted-foreground tabular-nums">
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            </section>

            {/* 4. Interviewer Persona */}
            <section className="space-y-3">
              <Label className="text-muted-foreground">Interviewer Persona</Label>
              <div className="grid grid-cols-3 gap-3">
                {personas.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPersona(p.id)}
                    className={cn(
                      "flex flex-col items-start gap-2 rounded-xl border bg-card p-4 text-left transition-all hover:shadow-sm",
                      persona === p.id
                        ? "border-primary ring-1 ring-primary/20"
                        : "border-border"
                    )}
                  >
                    <div className={cn("flex size-9 items-center justify-center rounded-full", p.color)}>
                      <p.icon className="size-4" />
                    </div>
                    <div>
                      <span className="text-sm font-medium">{p.label}</span>
                      <p className="mt-0.5 text-xs text-muted-foreground leading-snug">
                        {p.description}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 border-t px-6 py-4">
            <Button variant="ghost" onClick={() => router.push("/dashboard")}>Cancel</Button>
            <Button
              className="bg-primary text-primary-foreground"
              onClick={handleCreate}
              disabled={loading || !resumeVersionId}
            >
              {loading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Check className="size-4" />
              )}
              {loading ? "Creating..." : "Save"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function NewInterviewPage() {
  return (
    <Suspense>
      <NewInterviewForm />
    </Suspense>
  )
}
