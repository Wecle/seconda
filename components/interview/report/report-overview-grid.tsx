import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  TrendingUp,
  Info,
  ThumbsUp,
  BadgeCheck,
  AlertTriangle,
} from "lucide-react";

const radarLabels = [
  { angle: -90 },
  { angle: -30 },
  { angle: 30 },
  { angle: 90 },
  { angle: 150 },
  { angle: 210 },
];

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function RadarChart({
  values,
  labelNames,
}: {
  values: number[];
  labelNames: string[];
}) {
  const cx = 120;
  const cy = 120;
  const maxR = 90;
  const levels = [0.25, 0.5, 0.75, 1.0];

  const axisPoints = radarLabels.map((l) =>
    polarToCartesian(cx, cy, maxR, l.angle),
  );
  const dataPoints = values.map((v, i) =>
    polarToCartesian(cx, cy, maxR * v, radarLabels[i].angle),
  );
  return (
    <svg viewBox="0 0 240 240" className="mx-auto w-full max-w-[220px]">
      {levels.map((l) => {
        const pts = radarLabels
          .map((lab) => polarToCartesian(cx, cy, maxR * l, lab.angle))
          .map((p) => `${p.x},${p.y}`)
          .join(" ");
        return (
          <polygon
            key={l}
            points={pts}
            fill="none"
            stroke="currentColor"
            className="text-border"
            strokeWidth="1"
          />
        );
      })}
      {axisPoints.map((p, i) => (
        <line
          key={i}
          x1={cx}
          y1={cy}
          x2={p.x}
          y2={p.y}
          stroke="currentColor"
          className="text-border"
          strokeWidth="1"
        />
      ))}
      <polygon
        points={dataPoints.map((p) => `${p.x},${p.y}`).join(" ")}
        fill="var(--primary)"
        fillOpacity="0.2"
        stroke="var(--primary)"
        strokeWidth="2"
      />
      {dataPoints.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="3" fill="var(--primary)" />
      ))}
      {radarLabels.map((l, i) => {
        const pos = polarToCartesian(cx, cy, maxR + 20, l.angle);
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
        );
      })}
    </svg>
  );
}

function DonutChart({ score }: { score: number }) {
  const radius = 54;
  const stroke = 10;
  const circumference = 2 * Math.PI * radius;
  const progress = (score / 100) * circumference;
  const gap = circumference - progress;

  return (
    <svg viewBox="0 0 140 140" className="mx-auto h-[160px] w-[160px]">
      <circle
        cx="70"
        cy="70"
        r={radius}
        fill="none"
        stroke="currentColor"
        className="text-muted/50"
        strokeWidth={stroke}
      />
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
      <text
        x="70"
        y="74"
        textAnchor="middle"
        className="fill-foreground text-3xl font-bold"
        fontSize="28"
      >
        {score}
      </text>
      <text
        x="70"
        y="90"
        textAnchor="middle"
        className="fill-muted-foreground text-[11px]"
        fontSize="11"
      >
        / 100
      </text>
    </svg>
  );
}

interface ReportOverviewGridLabels {
  overallPerformance: string;
  competencyBreakdown: string;
  analysisSummary: string;
  topStrength: string;
  criticalFocus: string;
  noAnalysisData: string;
  score: string;
  strongPerformer: string;
  goodProgress: string;
  needsImprovement: string;
}

interface ReportOverviewGridProps {
  overallScore: number;
  radarValues: number[];
  radarLabelNames: string[];
  topStrengths: string[];
  criticalFocus: string[];
  labels: ReportOverviewGridLabels;
}

export function ReportOverviewGrid({
  overallScore,
  radarValues,
  radarLabelNames,
  topStrengths,
  criticalFocus,
  labels,
}: ReportOverviewGridProps) {
  return (
    <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-3">
      <Card className="md:h-[360px]">
        <CardHeader>
          <CardTitle className="text-sm">{labels.overallPerformance}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col items-center justify-center gap-3">
          <DonutChart score={overallScore} />
          <p className="text-sm font-semibold text-primary">
            {overallScore >= 80
              ? labels.strongPerformer
              : overallScore >= 60
                ? labels.goodProgress
                : labels.needsImprovement}
          </p>
          <div className="flex items-center gap-1 text-xs text-green-600">
            <TrendingUp className="size-3.5" />
            {labels.score}: {overallScore}/100
          </div>
        </CardContent>
      </Card>

      <Card className="md:h-[360px]">
        <CardHeader>
          <div className="flex w-full items-center justify-between">
            <CardTitle className="text-sm">{labels.competencyBreakdown}</CardTitle>
            <Button variant="ghost" size="icon-xs">
              <Info className="size-3.5 text-muted-foreground" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex flex-1 items-center justify-center">
          <RadarChart values={radarValues} labelNames={radarLabelNames} />
        </CardContent>
      </Card>

      <Card className="md:h-[360px]">
        <CardHeader className="rounded-t-xl">
          <CardTitle className="text-sm">{labels.analysisSummary}</CardTitle>
        </CardHeader>
        <CardContent className="min-h-0 flex-1">
          <ScrollArea className="h-full pr-3">
            <div className="flex flex-col gap-4 pb-1">
              {topStrengths.slice(0, 2).map((strength: string, i: number) => (
                <div key={i} className="flex items-start gap-3">
                  <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/40">
                    {i === 0 ? (
                      <ThumbsUp className="size-3.5 text-green-600" />
                    ) : (
                      <BadgeCheck className="size-3.5 text-blue-600" />
                    )}
                  </div>
                  <div>
                    <p
                      className={cn(
                        "text-[10px] font-semibold uppercase tracking-wider",
                        i === 0 ? "text-green-600" : "text-blue-600",
                      )}
                    >
                      {labels.topStrength}
                    </p>
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
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-orange-600">
                      {labels.criticalFocus}
                    </p>
                    <p className="text-sm text-foreground">{focus}</p>
                  </div>
                </div>
              ))}
              {topStrengths.length === 0 && criticalFocus.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {labels.noAnalysisData}
                </p>
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
