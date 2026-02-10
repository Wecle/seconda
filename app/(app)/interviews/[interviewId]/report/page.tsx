"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { useRouter, useParams } from "next/navigation"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import {
  Mic,
  Share2,
  FileDown,
  TrendingUp,
  Info,
  ThumbsUp,
  BadgeCheck,
  AlertTriangle,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Search,
  Loader2,
} from "lucide-react"
import { useTranslation } from "@/lib/i18n/context"

const radarLabels = [
  { label: "Understanding", angle: -90 },
  { label: "Expression", angle: -30 },
  { label: "Logic", angle: 30 },
  { label: "Depth", angle: 90 },
  { label: "Authenticity", angle: 150 },
  { label: "Reflection", angle: 210 },
]

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}

function RadarChart({ values, labelNames }: { values: number[]; labelNames: string[] }) {
  const cx = 120
  const cy = 120
  const maxR = 90
  const levels = [0.25, 0.5, 0.75, 1.0]

  const axisPoints = radarLabels.map((l) => polarToCartesian(cx, cy, maxR, l.angle))
  const dataPoints = values.map((v, i) =>
    polarToCartesian(cx, cy, maxR * v, radarLabels[i].angle)
  )
  return (
    <svg viewBox="0 0 240 240" className="w-full max-w-[220px] mx-auto">
      {levels.map((l) => {
        const pts = radarLabels
          .map((lab) => polarToCartesian(cx, cy, maxR * l, lab.angle))
          .map((p) => `${p.x},${p.y}`)
          .join(" ")
        return <polygon key={l} points={pts} fill="none" stroke="currentColor" className="text-border" strokeWidth="1" />
      })}
      {axisPoints.map((p, i) => (
        <line key={i} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="currentColor" className="text-border" strokeWidth="1" />
      ))}
      <polygon points={dataPoints.map((p) => `${p.x},${p.y}`).join(" ")} fill="var(--primary)" fillOpacity="0.2" stroke="var(--primary)" strokeWidth="2" />
      {dataPoints.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="3" fill="var(--primary)" />
      ))}
      {radarLabels.map((l, i) => {
        const pos = polarToCartesian(cx, cy, maxR + 20, l.angle)
        return (
          <text
            key={i}
            x={pos.x}
            y={pos.y}
            textAnchor="middle"
            dominantBaseline="central"
            className="fill-muted-foreground text-[9px]"
          >
            {labelNames[i]}
          </text>
        )
      })}
    </svg>
  )
}

function DonutChart({ score }: { score: number }) {
  const radius = 54
  const stroke = 10
  const circumference = 2 * Math.PI * radius
  const progress = (score / 100) * circumference
  const gap = circumference - progress

  return (
    <svg viewBox="0 0 140 140" className="w-[160px] h-[160px] mx-auto">
      <circle cx="70" cy="70" r={radius} fill="none" stroke="currentColor" className="text-muted/50" strokeWidth={stroke} />
      <circle
        cx="70"
        cy="70"
        r={radius}
        fill="none"
        stroke="var(--primary)"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${progress} ${gap}`}
        transform="rotate(-90 70 70)"
      />
      <text x="70" y="64" textAnchor="middle" className="fill-foreground text-3xl font-bold" fontSize="28">
        {score}
      </text>
      <text x="70" y="84" textAnchor="middle" className="fill-muted-foreground text-[11px]" fontSize="11">
        / 100
      </text>
    </svg>
  )
}

function getScoreColor(score: number) {
  if (score >= 8) return "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
  if (score >= 5) return "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300"
  return "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
}

function getTypeColor(type: string) {
  if (type?.toLowerCase().includes("behavioral")) return "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
  if (type?.toLowerCase().includes("system")) return "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300"
  return "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
}

interface ReportDimensions {
  name: string
  score: number
}

interface ReportJson {
  overallScore: number
  dimensions: ReportDimensions[]
  topStrengths: string[]
  criticalFocus: string[]
  summary: string
  nextSteps: string[]
}

interface InterviewData {
  id: string
  level: string
  type: string
  language: string
  questionCount: number
  persona: string
  status: string
  overallScore: number | null
  reportJson: ReportJson | null
  startedAt: string
  completedAt: string | null
}

interface QuestionScore {
  understanding: number
  expression: number
  logic: number
  depth: number
  authenticity: number
  reflection: number
  overall: number
}

interface QuestionFeedback {
  strengths?: string[]
  improvements?: string[]
  advice?: string[]
  deepDive?: unknown
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

interface InterviewApiResponse {
  interview: InterviewData
  questions: QuestionData[]
}

type FilterTab = "All" | "Behavioral" | "Technical"

export default function ReportPage() {
  const router = useRouter()
  const { interviewId } = useParams()
  const [data, setData] = useState<InterviewApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeFilter, setActiveFilter] = useState<FilterTab>("All")
  const { t } = useTranslation()

  useEffect(() => {
    fetch(`/api/interviews/${interviewId}`)
      .then(r => r.json())
      .then(d => {
        setData(d)
        setLoading(false)
      })
  }, [interviewId])

  const filterTabs: FilterTab[] = ["All", "Behavioral", "Technical"]

  const filterTabLabels: Record<FilterTab, string> = {
    All: t.report.all,
    Behavioral: t.interview.behavioral,
    Technical: t.interview.technical,
  }

  const radarLabelNames = [
    t.report.radarLabels.understanding,
    t.report.radarLabels.expression,
    t.report.radarLabels.logic,
    t.report.radarLabels.depth,
    t.report.radarLabels.authenticity,
    t.report.radarLabels.reflection,
  ]

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    )
  }

  const interview = data?.interview
  const questions = data?.questions || []
  const report = interview?.reportJson
  const overallScore = interview?.overallScore ?? 0

  const radarValues = report?.dimensions
    ? radarLabels.map(l => {
        const dim = report.dimensions.find((d: ReportDimensions) =>
          d.name?.toLowerCase() === l.label.toLowerCase()
        )
        return dim ? dim.score / 100 : 0.5
      })
    : [0.5, 0.5, 0.5, 0.5, 0.5, 0.5]

  const topStrengths = report?.topStrengths || []
  const criticalFocus = report?.criticalFocus || []

  const filteredQuestions = questions.filter((q: QuestionData) => {
    if (activeFilter === "All") return true
    return q.questionType?.toLowerCase().includes(activeFilter.toLowerCase())
  })

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-card border-b">
        <div className="max-w-[1200px] mx-auto flex items-center justify-between px-4 sm:px-8 h-14">
          <div className="flex items-center gap-2">
            <Mic className="size-5 text-primary" />
            <span className="font-semibold text-sm">{t.report.aiMockInterviewer}</span>
          </div>
          <div className="flex items-center gap-6">
            <nav className="hidden sm:flex items-center gap-5 text-sm text-muted-foreground">
              <Link href="/dashboard" className="hover:text-foreground transition-colors">{t.report.dashboard}</Link>
              <Link href="/dashboard" className="hover:text-foreground transition-colors">{t.report.history}</Link>
              <a href="#" className="hover:text-foreground transition-colors">{t.report.settings}</a>
            </nav>
            <div className="size-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-semibold">
              JD
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-[1200px] w-full mx-auto py-8 px-4 sm:px-8 pb-28">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-8">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-2xl font-bold tracking-tight">{t.report.title}</h1>
              <Badge className="bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 border-0">
                {interview?.status?.toUpperCase() || "COMPLETED"}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {interview?.type} &bull; {interview?.level} &bull; {questions.length} {t.report.questions}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm">
              <Share2 />
              {t.report.shareReport}
            </Button>
            <Button variant="outline" size="sm">
              <FileDown />
              {t.report.exportReport}
            </Button>
          </div>
        </div>

        {/* Metrics Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          {/* Overall Performance */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">{t.report.overallPerformance}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col items-center gap-3">
              <DonutChart score={overallScore} />
              <p className="text-sm font-semibold text-primary">
                {overallScore >= 80 ? t.report.strongPerformer : overallScore >= 60 ? t.report.goodProgress : t.report.needsImprovement}
              </p>
              <div className="flex items-center gap-1 text-xs text-green-600">
                <TrendingUp className="size-3.5" />
                {t.report.score}: {overallScore}/100
              </div>
            </CardContent>
          </Card>

          {/* Competency Breakdown */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between w-full">
                <CardTitle className="text-sm">{t.report.competencyBreakdown}</CardTitle>
                <Button variant="ghost" size="icon-xs">
                  <Info className="size-3.5 text-muted-foreground" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <RadarChart values={radarValues} labelNames={radarLabelNames} />
            </CardContent>
          </Card>

          {/* Analysis Summary */}
          <Card>
            <CardHeader className="bg-muted/50 rounded-t-xl">
              <CardTitle className="text-sm">{t.report.analysisSummary}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {topStrengths.slice(0, 2).map((strength: string, i: number) => (
                <div key={i} className="flex items-start gap-3">
                  <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/40">
                    {i === 0 ? <ThumbsUp className="size-3.5 text-green-600" /> : <BadgeCheck className="size-3.5 text-blue-600" />}
                  </div>
                  <div>
                    <p className={cn("text-[10px] font-semibold uppercase tracking-wider", i === 0 ? "text-green-600" : "text-blue-600")}>{t.report.topStrength}</p>
                    <p className="text-sm text-foreground">{strength}</p>
                  </div>
                </div>
              ))}
              {criticalFocus.slice(0, 1).map((focus: string, i: number) => (
                <div key={i} className="flex items-start gap-3">
                  <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-orange-100 dark:bg-orange-900/40">
                    <AlertTriangle className="size-3.5 text-orange-600" />
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-orange-600">{t.report.criticalFocus}</p>
                    <p className="text-sm text-foreground">{focus}</p>
                  </div>
                </div>
              ))}
              {topStrengths.length === 0 && criticalFocus.length === 0 && (
                <p className="text-sm text-muted-foreground">{t.report.noAnalysisData}</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Detailed Question Analysis */}
        <div className="mb-4">
          <h2 className="text-lg font-semibold mb-4">{t.report.detailedAnalysis}</h2>
          <div className="flex items-center gap-2 mb-4">
            {filterTabs.map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveFilter(tab)}
                className={cn(
                  "px-3 py-1.5 text-sm rounded-md font-medium transition-colors",
                  activeFilter === tab
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                )}
              >
                {filterTabLabels[tab]}
              </button>
            ))}
          </div>
        </div>

        <Accordion type="single" defaultValue={filteredQuestions[0]?.id} collapsible className="space-y-4">
          {filteredQuestions.map((q: QuestionData, idx: number) => {
            const score = q.score?.overall ?? 0
            const feedback = q.feedbackJson || q.feedback || {}
            const strengths = feedback.strengths || []
            const improvements = feedback.improvements || []
            const advice = feedback.advice || []

            return (
              <AccordionItem key={q.id} value={q.id} className="border rounded-xl bg-card shadow-sm overflow-hidden">
                <AccordionTrigger className="px-6 py-5 hover:no-underline">
                  <div className="flex flex-col gap-2 text-left w-full">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge className={cn("border-0 text-xs", getTypeColor(q.questionType))}>
                        Q{q.questionIndex ?? idx + 1} &bull; {q.questionType || q.topic || "Question"}
                      </Badge>
                      <Badge className={cn("border-0 text-xs", getScoreColor(score))}>
                        {t.report.score}: {score}/10
                      </Badge>
                    </div>
                    <p className="font-medium text-sm leading-snug">{q.question}</p>
                    {q.answerText && (
                      <p className="text-sm text-muted-foreground line-clamp-1">{q.answerText}</p>
                    )}
                    {score < 5 && (
                      <div className="flex items-center gap-1.5 text-orange-600 text-xs font-medium">
                        <AlertCircle className="size-3.5" />
                        {t.report.needsImprovementLabel}
                      </div>
                    )}
                    {score >= 8 && (
                      <div className="flex items-center gap-1.5 text-green-600 text-xs font-medium">
                        <CheckCircle2 className="size-3.5" />
                        {t.report.strongAnswer}
                      </div>
                    )}
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-6">
                  <div className="space-y-5">
                    {q.answerText && (
                      <div>
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">{t.report.yourAnswer}</h4>
                        <div className="bg-muted/50 rounded-lg p-4">
                          <p className="text-sm italic text-muted-foreground leading-relaxed">
                            &ldquo;{q.answerText}&rdquo;
                          </p>
                        </div>
                      </div>
                    )}

                    {(strengths.length > 0 || improvements.length > 0 || advice.length > 0) && (
                      <div>
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">{t.report.aiFeedback}</h4>
                        <div className="bg-primary/5 rounded-lg p-4">
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            {strengths.length > 0 && (
                              <div>
                                <p className="text-xs font-semibold text-green-600 mb-2 flex items-center gap-1.5">
                                  <span className="size-1.5 rounded-full bg-green-500" />
                                  {t.report.strengths}
                                </p>
                                <ul className="space-y-1.5">
                                  {strengths.map((s: string, i: number) => (
                                    <li key={i} className="text-sm text-foreground leading-snug">{s}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {improvements.length > 0 && (
                              <div>
                                <p className="text-xs font-semibold text-orange-600 mb-2 flex items-center gap-1.5">
                                  <span className="size-1.5 rounded-full bg-orange-500" />
                                  {t.report.improvements}
                                </p>
                                <ul className="space-y-1.5">
                                  {improvements.map((s: string, i: number) => (
                                    <li key={i} className="text-sm text-foreground leading-snug">{s}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {advice.length > 0 && (
                              <div>
                                <p className="text-xs font-semibold text-blue-600 mb-2 flex items-center gap-1.5">
                                  <span className="size-1.5 rounded-full bg-blue-500" />
                                  {t.report.advice}
                                </p>
                                <ul className="space-y-1.5">
                                  {advice.map((s: string, i: number) => (
                                    <li key={i} className="text-sm text-foreground leading-snug">{s}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    <Button className="w-full" onClick={() => router.push(`/interviews/${interviewId}/questions/${q.questionIndex}`)}>
                      <Search className="size-4" />
                      {t.report.deepDive}
                    </Button>
                  </div>
                </AccordionContent>
              </AccordionItem>
            )
          })}
        </Accordion>
      </main>

      {/* Floating Footer */}
      <div className="sticky bottom-6 z-50 flex justify-center pointer-events-none">
        <div className="pointer-events-auto bg-card border rounded-full px-2 py-2 shadow-lg">
          <Button className="rounded-full" size="lg" onClick={() => router.push("/dashboard")}>
            <RefreshCw className="size-4" />
            {t.report.startNewSession}
          </Button>
        </div>
      </div>
    </div>
  )
}