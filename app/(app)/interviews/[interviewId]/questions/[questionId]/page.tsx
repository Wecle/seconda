"use client"

import { useState, useEffect, useRef, useCallback } from "react"
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
  Loader2,
  Send,
  MessageSquare,
  GraduationCap,
  ArrowLeft,
} from "lucide-react"
import { BrandIcon } from "@/components/brand/brand-icon"
import { useTranslation } from "@/lib/i18n/context"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import { Markdown } from "@/components/ui/markdown"

interface QuestionScore {
  understanding: number
  expression: number
  logic: number
  depth: number
  authenticity: number
  reflection: number
  overall: number
}

interface DeepDiveData {
  coreConcepts?: {
    title?: string
    subtitle?: string
    items?: { name: string; description: string }[]
  }
  pitfalls?: string[]
  modelAnswer?: {
    approach?: string
    steps?: { title: string; description: string }[]
  }
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

interface DeepDiveMessage {
  id: string
  role: "assistant" | "user"
  content: string | null
  payload: Record<string, unknown> | null
  createdAt: string
}

type AccordionSection = "concepts" | "pitfalls" | "model"

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string")
}

export default function QuestionDeepDivePage() {
  const router = useRouter()
  const { interviewId, questionId: questionIdParam } = useParams()
  const { t } = useTranslation()
  const [expandedSections, setExpandedSections] = useState<Set<AccordionSection>>(
    new Set(["concepts", "model"])
  )
  const [activeTab, setActiveTab] = useState<"followup" | "coach">("followup")
  const [data, setData] = useState<InterviewApiResponse | null>(null)
  const [loading, setLoading] = useState(true)

  const [messages, setMessages] = useState<DeepDiveMessage[]>([])
  const [sessionStarted, setSessionStarted] = useState(false)
  const [inputText, setInputText] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [starting, setStarting] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch(`/api/interviews/${interviewId}`)
      .then(r => r.json())
      .then(d => {
        setData(d)
        setLoading(false)
      })
  }, [interviewId])

  const questions = data?.questions || []
  const questionIndex = parseInt(questionIdParam as string)
  const question = questions.find((q: QuestionData) => q.questionIndex === questionIndex)

  const loadSession = useCallback(async (mode: "followup" | "coach") => {
    if (!question) return
    try {
      const res = await fetch(
        `/api/interviews/${interviewId}/questions/${question.id}/deep-dive?mode=${mode}`
      )
      const data = await res.json()
      if (data.messages && data.messages.length > 0) {
        setMessages(data.messages)
        setSessionStarted(true)
      } else {
        setMessages([])
        setSessionStarted(false)
      }
    } catch {
      setMessages([])
      setSessionStarted(false)
    }
  }, [interviewId, question])

  useEffect(() => {
    if (question) {
      loadSession(activeTab)
    }
  }, [activeTab, question, loadSession])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

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

  async function handleStart() {
    if (!question) return
    setStarting(true)
    try {
      const res = await fetch(
        `/api/interviews/${interviewId}/questions/${question.id}/deep-dive/${activeTab}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "start" }),
        }
      )
      const data = await res.json()
      if (data.messages) {
        setMessages(data.messages)
        setSessionStarted(true)
      }
    } finally {
      setStarting(false)
    }
  }

  async function handleSubmitAnswer() {
    if (!question || !inputText.trim()) return
    setSubmitting(true)
    try {
      const res = await fetch(
        `/api/interviews/${interviewId}/questions/${question.id}/deep-dive/${activeTab}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "answer", answerText: inputText.trim() }),
        }
      )
      const data = await res.json()
      if (data.messages) {
        setMessages(data.messages)
        setInputText("")
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    )
  }

  const totalQuestions = questions.length
  const feedback = question?.feedback || question?.feedbackJson || {}
  const deepDive: DeepDiveData = feedback?.deepDive ?? {}
  const pitfalls = deepDive.pitfalls ?? []
  const modelSteps = deepDive.modelAnswer?.steps ?? []
  const score = question?.score?.overall ?? 0
  const hasPrev = questionIndex > 1
  const hasNext = questionIndex < totalQuestions

  return (
    <div className="flex h-screen flex-col overflow-hidden">
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

            {/* Deep Dive Reference (Accordions) */}
            <div className="space-y-2">
              {/* Core Concepts */}
              <div className="rounded-lg border bg-card">
                <button
                  onClick={() => toggleSection("concepts")}
                  className="flex w-full items-center gap-3 p-3"
                >
                  <div className="flex size-7 items-center justify-center rounded-lg bg-purple-100 dark:bg-purple-950">
                    <Lightbulb className="size-3.5 text-purple-600 dark:text-purple-400" />
                  </div>
                  <div className="flex-1 text-left">
                    <p className="text-xs font-semibold">{deepDive?.coreConcepts?.title || t.deepDive.coreConcepts}</p>
                  </div>
                  <ChevronDown
                    className={cn(
                      "size-3.5 text-muted-foreground transition-transform",
                      expandedSections.has("concepts") && "rotate-180"
                    )}
                  />
                </button>
                {expandedSections.has("concepts") && (
                  <div className="border-t px-3 pb-3 pt-2 space-y-3">
                    {deepDive?.coreConcepts?.items && deepDive.coreConcepts.items.length > 0 ? (
                      <div className="space-y-2">
                        {deepDive.coreConcepts.items.map((item, i) => (
                          <div key={i} className="space-y-1">
                            <div className="flex items-center gap-1.5">
                              <span className="size-1.5 rounded-full bg-blue-500" />
                              <span className="text-[11px] font-semibold">{item.name}</span>
                            </div>
                            <p className="text-[11px] leading-relaxed text-muted-foreground pl-3">
                              {item.description}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[11px] text-muted-foreground">{t.deepDive.noCoreConcepts}</p>
                    )}
                  </div>
                )}
              </div>

              {/* Common Pitfalls */}
              <div className="rounded-lg border bg-card">
                <button
                  onClick={() => toggleSection("pitfalls")}
                  className="flex w-full items-center gap-3 p-3"
                >
                  <div className="flex size-7 items-center justify-center rounded-lg bg-red-100 dark:bg-red-950">
                    <AlertTriangle className="size-3.5 text-red-600 dark:text-red-400" />
                  </div>
                  <div className="flex-1 text-left">
                    <p className="text-xs font-semibold">{t.deepDive.commonPitfalls}</p>
                  </div>
                  <ChevronDown
                    className={cn(
                      "size-3.5 text-muted-foreground transition-transform",
                      expandedSections.has("pitfalls") && "rotate-180"
                    )}
                  />
                </button>
                {expandedSections.has("pitfalls") && (
                  <div className="border-t px-3 pb-3 pt-2 space-y-2">
                    {pitfalls.length > 0 ? (
                      <ul className="space-y-1.5 text-[11px] leading-relaxed text-muted-foreground">
                        {pitfalls.map((pitfall, i) => (
                          <li key={i} className="flex gap-1.5">
                            <span className="mt-1 size-1.5 shrink-0 rounded-full bg-red-400" />
                            {pitfall}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-[11px] text-muted-foreground">{t.deepDive.noPitfalls}</p>
                    )}
                  </div>
                )}
              </div>

              {/* Model Answer */}
              <div className="rounded-lg border bg-card">
                <button
                  onClick={() => toggleSection("model")}
                  className="flex w-full items-center gap-3 p-3"
                >
                  <div className="flex size-7 items-center justify-center rounded-lg bg-green-100 dark:bg-green-950">
                    <BadgeCheck className="size-3.5 text-green-600 dark:text-green-400" />
                  </div>
                  <div className="flex-1 text-left">
                    <p className="text-xs font-semibold">{t.deepDive.modelAnswerStructure}</p>
                  </div>
                  <ChevronDown
                    className={cn(
                      "size-3.5 text-muted-foreground transition-transform",
                      expandedSections.has("model") && "rotate-180"
                    )}
                  />
                </button>
                {expandedSections.has("model") && (
                  <div className="border-t px-3 pb-3 pt-2 space-y-3">
                    {modelSteps.length > 0 ? (
                      <div className="space-y-3">
                        {modelSteps.map((step, i) => (
                          <div key={i} className="flex gap-2">
                            <div className="flex flex-col items-center">
                              <div className="flex size-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                                {i + 1}
                              </div>
                              {i < modelSteps.length - 1 && (
                                <div className="mt-1 flex-1 w-px bg-border" />
                              )}
                            </div>
                            <div className="flex-1 pb-2">
                              <p className="text-[11px] font-semibold">{step.title}</p>
                              <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                                {step.description}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[11px] text-muted-foreground">{t.deepDive.noModelAnswer}</p>
                    )}
                  </div>
                )}
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
          <div className="flex items-center justify-between border-b bg-card px-4 py-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push(`/interviews/${interviewId}/report`)}
            >
              <ArrowLeft className="size-4" />
              {t.deepDive.backToReport}
            </Button>
            <div className="flex rounded-lg bg-muted p-1">
              <button
                onClick={() => setActiveTab("followup")}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-4 py-1.5 text-xs font-medium transition-all",
                  activeTab === "followup"
                    ? "bg-white text-primary shadow-sm dark:bg-card"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <MessageSquare className="size-3.5" />
                {t.deepDive.followUpMode}
              </button>
              <button
                onClick={() => setActiveTab("coach")}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-4 py-1.5 text-xs font-medium transition-all",
                  activeTab === "coach"
                    ? "bg-white text-primary shadow-sm dark:bg-card"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <GraduationCap className="size-3.5" />
                {t.deepDive.coachMode}
              </button>
            </div>
            <div className="w-24" />
          </div>

          {/* Interactive Content */}
          <div className="flex flex-1 flex-col overflow-hidden">
            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto">
              <div className="mx-auto max-w-3xl px-8 py-6 space-y-4">
                {!sessionStarted ? (
                  <div className="flex flex-col items-center justify-center py-20 space-y-4">
                    <div className={cn(
                      "flex size-16 items-center justify-center rounded-2xl",
                      activeTab === "followup" ? "bg-orange-100 dark:bg-orange-950" : "bg-emerald-100 dark:bg-emerald-950"
                    )}>
                      {activeTab === "followup" ? (
                        <MessageSquare className="size-8 text-orange-600 dark:text-orange-400" />
                      ) : (
                        <GraduationCap className="size-8 text-emerald-600 dark:text-emerald-400" />
                      )}
                    </div>
                    <div className="text-center space-y-2">
                      <h2 className="text-lg font-semibold">
                        {activeTab === "followup" ? t.deepDive.followUpMode : t.deepDive.coachMode}
                      </h2>
                      <p className="text-sm text-muted-foreground max-w-md">
                        {activeTab === "followup" ? t.deepDive.followUpDescription : t.deepDive.coachDescription}
                      </p>
                    </div>
                    <Button onClick={handleStart} disabled={starting}>
                      {starting ? (
                        <>
                          <Loader2 className="size-4 animate-spin" />
                          {t.deepDive.generating}
                        </>
                      ) : (
                        activeTab === "followup" ? t.deepDive.startFollowUp : t.deepDive.startCoach
                      )}
                    </Button>
                  </div>
                ) : (
                  <>
                    {messages.map((msg) => (
                      <MessageBubble key={msg.id} message={msg} mode={activeTab} t={t} />
                    ))}
                    <div ref={messagesEndRef} />
                  </>
                )}
              </div>
            </div>

            {/* Input Area */}
            {sessionStarted && (
              <div className="border-t bg-card p-4">
                <div className="mx-auto max-w-3xl">
                  <div className="flex gap-2">
                    <Textarea
                      value={inputText}
                      onChange={(e) => setInputText(e.target.value)}
                      placeholder={t.deepDive.typeYourAnswer}
                      className="min-h-10 max-h-32 resize-none"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault()
                          handleSubmitAnswer()
                        }
                      }}
                      disabled={submitting}
                    />
                    <Button
                      size="icon"
                      onClick={handleSubmitAnswer}
                      disabled={submitting || !inputText.trim()}
                      className="shrink-0"
                    >
                      {submitting ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Send className="size-4" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}

function MessageBubble({
  message,
  mode,
  t,
}: {
  message: DeepDiveMessage
  mode: "followup" | "coach"
  t: ReturnType<typeof useTranslation>["t"]
}) {
  const payload = message.payload as Record<string, unknown> | null

  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-md bg-primary px-4 py-3 text-primary-foreground">
          <p className="text-sm leading-relaxed">{message.content}</p>
        </div>
      </div>
    )
  }

  if (mode === "followup") {
    return (
      <div className="flex gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-orange-100 dark:bg-orange-950">
          <MessageSquare className="size-4 text-orange-600 dark:text-orange-400" />
        </div>
        <div className="flex-1 space-y-2">
          {typeof payload?.comment === "string" && payload.comment && (
            <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
              <p className="text-[11px] font-medium text-amber-700 dark:text-amber-400 mb-1">
                {t.deepDive.followUpComment}
              </p>
              <Markdown className="text-sm leading-relaxed text-foreground">
                {payload.comment as string}
              </Markdown>
            </div>
          )}
          <div className="rounded-2xl rounded-bl-md bg-muted px-4 py-3">
            <p className="text-[11px] font-medium text-muted-foreground mb-1">
              {t.deepDive.followUpQuestion}
            </p>
            <Markdown className="text-sm font-medium leading-relaxed">
              {(payload?.question as string) || message.content || ""}
            </Markdown>
          </div>
        </div>
      </div>
    )
  }

  // Coach mode
  const isEvaluation = payload?.type === "evaluation"
  const improvements = toStringArray(payload?.improvements)
  const commonMistakes = toStringArray(payload?.commonMistakes)

  if (isEvaluation) {
    const scores = payload?.scores as Record<string, number> | undefined
    const overall = scores?.overall ?? 0
    return (
      <div className="flex gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-950">
          <GraduationCap className="size-4 text-emerald-600 dark:text-emerald-400" />
        </div>
        <div className="flex-1 space-y-3">
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-4 dark:border-emerald-900 dark:bg-emerald-950/30">
            <div className="flex items-center gap-2 mb-3">
              <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">
                {t.deepDive.coachScore}: {overall}/10
              </Badge>
              <span className="text-sm font-medium">{t.deepDive.coachEvaluation}</span>
            </div>
            <Markdown className="text-sm leading-relaxed mb-3">
              {(payload?.briefFeedback as string) || ""}
            </Markdown>
            {scores && (
              <div className="grid grid-cols-3 gap-2 mb-3">
                {(["understanding", "expression", "logic", "depth", "authenticity", "reflection"] as const).map((dim) => (
                  <div key={dim} className="flex items-center justify-between rounded-md bg-white/60 dark:bg-white/5 px-2 py-1">
                    <span className="text-[11px] text-muted-foreground">{t.report.radarLabels[dim]}</span>
                    <span className="text-xs font-semibold">{scores[dim]}</span>
                  </div>
                ))}
              </div>
            )}
            {improvements.length > 0 && (
              <div>
                <p className="text-[11px] font-medium text-muted-foreground mb-1">{t.deepDive.coachImprovements}</p>
                <ul className="space-y-1">
                  {improvements.map((item, i) => (
                    <li key={i} className="flex gap-1.5 text-xs text-muted-foreground">
                      <span className="mt-1.5 size-1 shrink-0 rounded-full bg-emerald-500" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  // Coach start message
  return (
    <div className="flex gap-3">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-950">
        <GraduationCap className="size-4 text-emerald-600 dark:text-emerald-400" />
      </div>
      <div className="flex-1 space-y-3">
        {typeof payload?.explanation === "string" && payload.explanation && (
          <div className="rounded-lg border bg-card p-4 space-y-2">
            <div className="flex items-center gap-2">
              <Lightbulb className="size-4 text-purple-500" />
              <span className="text-xs font-semibold">{t.deepDive.coachExplanation}</span>
            </div>
            <Markdown className="text-sm leading-relaxed text-muted-foreground">
              {payload.explanation as string}
            </Markdown>
          </div>
        )}
        {commonMistakes.length > 0 && (
          <div className="rounded-lg border border-red-200 bg-red-50/50 p-4 dark:border-red-900 dark:bg-red-950/30 space-y-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-red-500" />
              <span className="text-xs font-semibold">{t.deepDive.coachMistakes}</span>
            </div>
            <ul className="space-y-1.5">
              {commonMistakes.map((mistake, i) => (
                <li key={i} className="flex gap-1.5 text-sm text-muted-foreground">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-red-400" />
                  {mistake}
                </li>
              ))}
            </ul>
          </div>
        )}
        {typeof payload?.practiceQuestion === "string" && payload.practiceQuestion && (
          <div className="rounded-2xl rounded-bl-md bg-muted px-4 py-3">
            <p className="text-[11px] font-medium text-muted-foreground mb-1">{t.deepDive.coachPractice}</p>
            <Markdown className="text-sm font-medium leading-relaxed">
              {payload.practiceQuestion as string}
            </Markdown>
          </div>
        )}
      </div>
    </div>
  )
}
