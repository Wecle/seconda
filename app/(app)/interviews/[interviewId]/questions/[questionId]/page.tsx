"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { useRouter, useParams } from "next/navigation"
import {
  Settings,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  Lightbulb,
  AlertTriangle,
  BadgeCheck,
  Sparkles,
  Clock,
  CheckCircle2,
  Loader2,
} from "lucide-react"
import { BrandIcon } from "@/components/brand/brand-icon"
import { useTranslation } from "@/lib/i18n/context"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Separator } from "@/components/ui/separator"

interface QuestionScore {
  understanding: number
  expression: number
  logic: number
  depth: number
  authenticity: number
  reflection: number
  overall: number
}

interface DeepDiveCoreConcepts {
  title?: string
  subtitle?: string
  items?: { name: string; description: string }[]
}

interface DeepDiveModelAnswer {
  approach?: string
  steps?: { title: string; description: string }[]
}

interface DeepDiveData {
  coreConcepts?: DeepDiveCoreConcepts
  pitfalls?: string[]
  modelAnswer?: DeepDiveModelAnswer
}

interface QuestionFeedback {
  strengths?: string[]
  improvements?: string[]
  advice?: string[]
  summary?: string
  overallFeedback?: string
  deepDive?: DeepDiveData
}

interface QuestionData {
  id: string
  questionIndex: number
  questionType: string
  topic: string | null
  question: string
  tip: string | null
  answerText: string | null
  answeredAt: string | null
  score: QuestionScore | null
  feedback: QuestionFeedback | null
  feedbackJson?: QuestionFeedback | null
}

interface InterviewData {
  id: string
  questionCount: number
  status: string
}

interface InterviewApiResponse {
  interview: InterviewData
  questions: QuestionData[]
}

type AccordionSection = "concepts" | "pitfalls" | "model"

export default function QuestionDeepDivePage() {
  const router = useRouter()
  const { interviewId, questionId } = useParams()
  const { t } = useTranslation()
  const [expandedSections, setExpandedSections] = useState<Set<AccordionSection>>(
    new Set(["concepts", "model"])
  )
  const [activeTab, setActiveTab] = useState<"followup" | "coach">("coach")
  const [data, setData] = useState<InterviewApiResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/interviews/${interviewId}`)
      .then(r => r.json())
      .then(d => {
        setData(d)
        setLoading(false)
      })
  }, [interviewId])

  function toggleSection(section: AccordionSection) {
    setExpandedSections((prev) => {
      const next = new Set(prev)
      if (next.has(section)) {
        next.delete(section)
      } else {
        next.add(section)
      }
      return next
    })
  }

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    )
  }

  const questions = data?.questions || []
  const questionIndex = parseInt(questionId as string)
  const question = questions.find((q: QuestionData) => q.questionIndex === questionIndex)
  const totalQuestions = questions.length

  const feedback = question?.feedbackJson || question?.feedback || {}
  const deepDive: DeepDiveData = feedback?.deepDive ?? {}
  const pitfalls = deepDive.pitfalls ?? []
  const modelSteps = deepDive.modelAnswer?.steps ?? []
  const score = question?.score?.overall ?? 0

  const hasPrev = questionIndex > 1
  const hasNext = questionIndex < totalQuestions

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between border-b bg-card px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2.5">
            <Link href="/" className="flex items-center gap-2">
              <BrandIcon size={24} />
              <span className="text-sm font-semibold">Seconda</span>
            </Link>
          </div>
          <Separator orientation="vertical" className="h-5" />
          <nav className="flex items-center gap-1 text-xs text-muted-foreground">
            <Link href="/" className="hover:text-foreground cursor-pointer">{t.deepDive.home}</Link>
            <ChevronRight className="size-3" />
            <Link href={`/interviews/${interviewId}/report`} className="hover:text-foreground cursor-pointer">{t.deepDive.interviewReport}</Link>
            <ChevronRight className="size-3" />
            <span className="text-foreground font-medium">{t.deepDive.deepDiveLabel}</span>
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon-sm">
            <Settings className="size-4" />
          </Button>
          <Avatar size="sm">
            <AvatarFallback>JD</AvatarFallback>
          </Avatar>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Panel */}
        <aside className="flex w-full flex-col border-r lg:w-5/12 xl:w-1/3">
          <div className="flex-1 overflow-y-auto p-5 space-y-6">
            {/* Original Question */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="flex size-6 items-center justify-center rounded-md bg-primary/10">
                  <Sparkles className="size-3.5 text-primary" />
                </div>
                <span className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                  {t.deepDive.originalQuestion}
                </span>
              </div>
              <div className="rounded-lg border bg-card p-4">
                <p className="text-sm font-semibold leading-relaxed">
                  {question?.question || t.deepDive.questionNotFound}
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {question?.questionType && (
                    <Badge variant="secondary" className="text-[11px]">
                      {question.questionType}
                    </Badge>
                  )}
                  {question?.topic && (
                    <Badge variant="secondary" className="text-[11px]">
                      {question.topic}
                    </Badge>
                  )}
                </div>
              </div>
            </div>

            {/* Your Answer */}
            <div className="relative space-y-3">
              <div className="absolute left-[11px] top-7 bottom-0 w-px bg-border" />
              <div className="relative flex items-center gap-2">
                <Avatar size="sm">
                  <AvatarFallback className="text-[10px]">JD</AvatarFallback>
                </Avatar>
                <span className="text-xs font-medium">{t.deepDive.yourAnswer}</span>
                <div className="ml-auto flex items-center gap-1 text-muted-foreground">
                  <Clock className="size-3" />
                  <span className="text-[11px]">—</span>
                </div>
              </div>
              <div className="ml-7 rounded-lg bg-muted/60 p-3">
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {question?.answerText || t.deepDive.noAnswer}
                </p>
              </div>
            </div>

            {/* Initial Feedback */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="flex size-6 items-center justify-center rounded-full bg-primary">
                  <Sparkles className="size-3.5 text-white" />
                </div>
                <span className="text-xs font-medium">{t.deepDive.initialFeedback}</span>
              </div>
              <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-4 dark:border-blue-900 dark:bg-blue-950/30">
                <div className="mb-2 flex items-center gap-2">
                  <Badge className="bg-blue-600 text-white hover:bg-blue-600">{score}/10</Badge>
                  <span className="text-sm font-medium">
                    {score >= 8 ? t.deepDive.strongAnswer : score >= 5 ? t.deepDive.solidFoundation : t.deepDive.needsWork}
                  </span>
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {feedback?.summary || feedback?.overallFeedback || t.deepDive.noFeedback}
                </p>
              </div>
            </div>
          </div>

          {/* Navigation Footer */}
          <div className="flex items-center justify-between border-t bg-card px-4 py-3">
            <Button
              variant="ghost"
              size="sm"
              disabled={!hasPrev}
              onClick={() => router.push(`/interviews/${interviewId}/questions/${questionIndex - 1}`)}
            >
              <ChevronLeft className="size-4" />
              {t.common.previous}
            </Button>
            <span className="text-xs text-muted-foreground">{t.deepDive.questionOf.replace("{current}", String(questionIndex)).replace("{total}", String(totalQuestions))}</span>
            <Button
              variant="ghost"
              size="sm"
              disabled={!hasNext}
              onClick={() => router.push(`/interviews/${interviewId}/questions/${questionIndex + 1}`)}
            >
              {t.common.next}
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </aside>

        {/* Right Panel */}
        <main className="hidden flex-1 flex-col bg-background lg:flex">
          {/* Tab Switcher */}
          <div className="flex justify-center border-b bg-card px-4 py-3">
            <div className="flex rounded-lg bg-muted p-1">
              <button
                onClick={() => setActiveTab("followup")}
                className={cn(
                  "rounded-md px-4 py-1.5 text-xs font-medium transition-all",
                  activeTab === "followup"
                    ? "bg-white text-primary shadow-sm dark:bg-card"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {t.deepDive.followUpMode}
              </button>
              <button
                onClick={() => setActiveTab("coach")}
                className={cn(
                  "rounded-md px-4 py-1.5 text-xs font-medium transition-all",
                  activeTab === "coach"
                    ? "bg-white text-primary shadow-sm dark:bg-card"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {t.deepDive.coachMode}
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="relative flex-1 overflow-y-auto">
            <div className="mx-auto max-w-3xl px-8 py-8 pb-24 space-y-6">
              <div className="space-y-1">
                <h1 className="text-xl font-semibold">{t.deepDive.title}</h1>
                <p className="text-sm text-muted-foreground">
                  {t.deepDive.description}
                </p>
              </div>

              {/* Accordion 1 - Core Concepts */}
              <div className="rounded-lg border bg-card">
                <button
                  onClick={() => toggleSection("concepts")}
                  className="flex w-full items-center gap-3 p-4"
                >
                  <div className="flex size-8 items-center justify-center rounded-lg bg-purple-100 dark:bg-purple-950">
                    <Lightbulb className="size-4 text-purple-600 dark:text-purple-400" />
                  </div>
                  <div className="flex-1 text-left">
                    <p className="text-sm font-semibold">{deepDive?.coreConcepts?.title || t.deepDive.coreConcepts}</p>
                    <p className="text-xs text-muted-foreground">
                      {deepDive?.coreConcepts?.subtitle || t.deepDive.coreConceptsSub}
                    </p>
                  </div>
                  <ChevronDown
                    className={cn(
                      "size-4 text-muted-foreground transition-transform",
                      expandedSections.has("concepts") && "rotate-180"
                    )}
                  />
                </button>
                {expandedSections.has("concepts") && (
                  <div className="border-t px-4 pb-4 pt-3 space-y-4">
                    {deepDive?.coreConcepts?.items ? (
                      <div className="grid gap-4 sm:grid-cols-2">
                        {deepDive.coreConcepts.items.map((item: { name: string; description: string }, i: number) => (
                          <div key={i} className="space-y-2">
                            <div className="flex items-center gap-2">
                              <span className="size-2 rounded-full bg-blue-500" />
                              <span className="text-xs font-semibold">{item.name}</span>
                            </div>
                            <p className="text-xs leading-relaxed text-muted-foreground">
                              {item.description}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">{t.deepDive.noCoreConcepts}</p>
                    )}
                  </div>
                )}
              </div>

              {/* Accordion 2 - Common Pitfalls */}
              <div className="rounded-lg border bg-card">
                <button
                  onClick={() => toggleSection("pitfalls")}
                  className="flex w-full items-center gap-3 p-4"
                >
                  <div className="flex size-8 items-center justify-center rounded-lg bg-red-100 dark:bg-red-950">
                    <AlertTriangle className="size-4 text-red-600 dark:text-red-400" />
                  </div>
                  <div className="flex-1 text-left">
                    <p className="text-sm font-semibold">{t.deepDive.commonPitfalls}</p>
                    <p className="text-xs text-muted-foreground">
                      {t.deepDive.commonPitfallsSub}
                    </p>
                  </div>
                  <ChevronDown
                    className={cn(
                      "size-4 text-muted-foreground transition-transform",
                      expandedSections.has("pitfalls") && "rotate-180"
                    )}
                  />
                </button>
                {expandedSections.has("pitfalls") && (
                  <div className="border-t px-4 pb-4 pt-3 space-y-3">
                    {pitfalls.length > 0 ? (
                      <ul className="space-y-2 text-xs leading-relaxed text-muted-foreground">
                        {pitfalls.map((pitfall: string, i: number) => (
                          <li key={i} className="flex gap-2">
                            <span className="mt-1 size-1.5 shrink-0 rounded-full bg-red-400" />
                            {pitfall}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-muted-foreground">{t.deepDive.noPitfalls}</p>
                    )}
                  </div>
                )}
              </div>

              {/* Accordion 3 - Model Answer Structure */}
              <div className="rounded-lg border bg-card">
                <button
                  onClick={() => toggleSection("model")}
                  className="flex w-full items-center gap-3 p-4"
                >
                  <div className="flex size-8 items-center justify-center rounded-lg bg-green-100 dark:bg-green-950">
                    <BadgeCheck className="size-4 text-green-600 dark:text-green-400" />
                  </div>
                  <div className="flex-1 text-left">
                    <p className="text-sm font-semibold">{t.deepDive.modelAnswerStructure}</p>
                    <p className="text-xs text-muted-foreground">{deepDive?.modelAnswer?.approach || t.deepDive.recommendedApproach}</p>
                  </div>
                  <ChevronDown
                    className={cn(
                      "size-4 text-muted-foreground transition-transform",
                      expandedSections.has("model") && "rotate-180"
                    )}
                  />
                </button>
                {expandedSections.has("model") && (
                  <div className="border-t px-4 pb-4 pt-3 space-y-4">
                    {modelSteps.length > 0 ? (
                      <div className="space-y-4">
                        {modelSteps.map((step: { title: string; description: string }, i: number) => (
                          <div key={i} className="flex gap-3">
                            <div className="flex flex-col items-center">
                              <div className="flex size-6 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
                                {i + 1}
                              </div>
                              {i < modelSteps.length - 1 && (
                                <div className="mt-1 flex-1 w-px bg-border" />
                              )}
                            </div>
                            <div className="flex-1 pb-4">
                              <p className="text-sm font-semibold">{step.title}</p>
                              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                                {step.description}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">{t.deepDive.noModelAnswer}</p>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Floating Action Button */}
            <div className="absolute bottom-8 right-8">
              <Button size="default" className="shadow-lg" onClick={() => router.push(`/interviews/${interviewId}/report`)}>
                <CheckCircle2 className="size-4" />
                {t.deepDive.markReviewCompleted}
              </Button>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
