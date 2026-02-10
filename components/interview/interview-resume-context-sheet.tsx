"use client";

import dynamic from "next/dynamic";
import Fuse from "fuse.js";
import { Segment, useDefault as segmentitUseDefault } from "segmentit";
import { useMemo, useState } from "react";
import { FileText, Loader2, Sparkles } from "lucide-react";
import { ParsedResumePreview } from "@/components/resume/parsed-resume-preview";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTranslation } from "@/lib/i18n/context";
import type { ParsedResume } from "@/lib/resume/types";

const ResumePdfPreview = dynamic(
  () =>
    import("@/components/resume/pdf-preview").then(
      (module) => module.ResumePdfPreview,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[calc(100vh-280px)] items-center justify-center rounded-md border bg-muted/20">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    ),
  },
);

interface ResumeSearchItem {
  id: string;
  text: string;
  weight: number;
}

interface ResumeTermStat {
  term: string;
  key: string;
  docCount: number;
  score: number;
}

const segment = segmentitUseDefault(new Segment());

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function normalizeTermKey(term: string): string {
  return /^[a-z0-9+#./_-]+$/i.test(term) ? term.toLowerCase() : term;
}

function buildSearchItems(parsed: ParsedResume): ResumeSearchItem[] {
  const items: ResumeSearchItem[] = [];
  const pushItem = (id: string, text: string, weight: number) => {
    const normalized = normalizeText(text);
    if (!normalized) return;
    items.push({ id, text: normalized, weight });
  };

  pushItem("summary", parsed.summary, 1.05);

  for (let i = 0; i < parsed.skills.length; i += 1) {
    pushItem(`skill-${i}`, parsed.skills[i], 1.4);
  }

  for (let i = 0; i < parsed.experience.length; i += 1) {
    const exp = parsed.experience[i];
    pushItem(`exp-role-${i}`, `${exp.title} ${exp.company} ${exp.period}`, 1.2);
    for (let j = 0; j < exp.bullets.length; j += 1) {
      pushItem(`exp-bullet-${i}-${j}`, exp.bullets[j], 1.15);
    }
  }

  for (let i = 0; i < (parsed.education?.length ?? 0); i += 1) {
    const edu = parsed.education![i];
    pushItem(
      `edu-${i}`,
      `${edu.degree} ${edu.school} ${edu.period ?? ""}`,
      0.95,
    );
  }

  for (let i = 0; i < (parsed.projects?.length ?? 0); i += 1) {
    const project = parsed.projects![i];
    pushItem(`project-name-${i}`, project.name, 1.35);
    pushItem(`project-desc-${i}`, project.description, 1.2);
    for (let j = 0; j < (project.tags?.length ?? 0); j += 1) {
      pushItem(`project-tag-${i}-${j}`, project.tags![j], 1.3);
    }
  }

  return items;
}

function tokenizeRawText(input: string): string[] {
  const text = normalizeText(input);
  if (!text) return [];

  const segmented =
    (segment.doSegment(text, { simple: true }) as string[] | undefined) ?? [];

  const tokens: string[] = [];

  const addToken = (raw: string) => {
    const cleaned = raw
      .trim()
      .replace(/^[^\p{L}\p{N}+#./_-]+|[^\p{L}\p{N}+#./_-]+$/gu, "");
    if (!cleaned) return;

    if (/^[a-z0-9+#./_-]+$/i.test(cleaned)) {
      const normalized = cleaned.toLowerCase();
      if (normalized.length >= 2) {
        tokens.push(normalized);
      }

      const splitParts = cleaned
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .split(/[\s/_-]+/)
        .map((part) => part.trim().toLowerCase())
        .filter(Boolean);

      for (const part of splitParts) {
        if (part.length >= 2) {
          tokens.push(part);
        }
      }

      return;
    }

    if (/[\u4e00-\u9fff]/.test(cleaned) && cleaned.length >= 2) {
      tokens.push(cleaned);
    }
  };

  for (const token of segmented) {
    addToken(token);
  }

  const chineseChunks = text.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
  for (const chunk of chineseChunks) {
    if (chunk.length <= 18) {
      tokens.push(chunk);
    }
    const maxNgram = Math.min(4, chunk.length);
    for (let n = 2; n <= maxNgram; n += 1) {
      for (let i = 0; i <= chunk.length - n; i += 1) {
        tokens.push(chunk.slice(i, i + n));
      }
    }
  }

  return Array.from(new Set(tokens));
}

function buildTermStats(items: ResumeSearchItem[]): ResumeTermStat[] {
  const termMap = new Map<string, ResumeTermStat>();

  for (const item of items) {
    const tokens = tokenizeRawText(item.text);
    const uniqueKeys = new Set<string>();

    for (const token of tokens) {
      const key = normalizeTermKey(token);
      uniqueKeys.add(key);

      const current = termMap.get(key);
      if (current) {
        current.score += item.weight;
      } else {
        termMap.set(key, {
          term: token,
          key,
          docCount: 0,
          score: item.weight,
        });
      }
    }

    for (const key of uniqueKeys) {
      const current = termMap.get(key);
      if (current) {
        current.docCount += 1;
      }
    }
  }

  return Array.from(termMap.values()).filter((item) => {
    if (/^\d+$/.test(item.term)) return false;
    if (/^[a-z0-9+#./_-]+$/i.test(item.term) && item.term.length < 2) return false;
    if (/[\u4e00-\u9fff]/.test(item.term) && item.term.length < 2) return false;
    return true;
  });
}

function extractKeywordsWithFuse(
  question: string,
  parsed: ParsedResume,
): string[] {
  const normalizedQuestion = normalizeText(question);
  if (!normalizedQuestion) return [];

  const searchItems = buildSearchItems(parsed);
  if (searchItems.length === 0) return [];

  const termStats = buildTermStats(searchItems);
  if (termStats.length === 0) return [];

  const queryTokens = tokenizeRawText(normalizedQuestion);
  if (queryTokens.length === 0) return [];

  const queryTokenKeys = new Set(queryTokens.map(normalizeTermKey));

  const itemFuse = new Fuse(searchItems, {
    keys: ["text"],
    includeScore: true,
    ignoreLocation: true,
    findAllMatches: true,
    minMatchCharLength: 2,
    threshold: 0.42,
  });

  const termFuse = new Fuse(termStats, {
    keys: ["term"],
    includeScore: true,
    ignoreLocation: true,
    minMatchCharLength: 2,
    threshold: 0.35,
  });

  const keywordScores = new Map<string, { term: string; score: number }>();

  const addScore = (term: string, score: number) => {
    if (score <= 0) return;
    const normalizedTerm = normalizeText(term);
    if (normalizedTerm.length < 2) return;
    const key = normalizeTermKey(normalizedTerm);

    const current = keywordScores.get(key);
    if (current) {
      current.score += score;
      if (normalizedTerm.length > current.term.length) {
        current.term = normalizedTerm;
      }
      return;
    }

    keywordScores.set(key, { term: normalizedTerm, score });
  };

  for (const queryToken of queryTokens) {
    const queryKey = normalizeTermKey(queryToken);
    const queryWeight = Math.min(1.9, 0.75 + queryToken.length / 8);
    const termResults = termFuse.search(queryToken, { limit: 10 });

    for (const termResult of termResults) {
      const similarity = 1 - (termResult.score ?? 1);
      if (similarity < 0.35) continue;

      const matched = termResult.item;
      const coverage = matched.docCount / searchItems.length;
      const specificity = Math.max(0.08, 1 - coverage);
      const exactBoost = matched.key === queryKey ? 1.45 : 1;

      addScore(
        matched.term,
        similarity * specificity * queryWeight * exactBoost,
      );
    }
  }

  const itemResults = itemFuse.search(normalizedQuestion, { limit: 10 });
  for (const itemResult of itemResults) {
    const relevance = Math.max(0.1, 1 - (itemResult.score ?? 1));
    const itemTokens = tokenizeRawText(itemResult.item.text);

    for (const token of itemTokens) {
      const tokenKey = normalizeTermKey(token);

      if (queryTokenKeys.has(tokenKey)) {
        addScore(token, relevance * itemResult.item.weight * 0.9);
        continue;
      }

      for (const queryToken of queryTokens) {
        if (token.includes(queryToken) || queryToken.includes(token)) {
          addScore(token, relevance * itemResult.item.weight * 0.45);
          break;
        }
      }
    }
  }

  if (keywordScores.size === 0) {
    const allResumeText = searchItems
      .map((item) => item.text)
      .join("\n")
      .toLowerCase();

    for (const term of queryTokens) {
      if (allResumeText.includes(term.toLowerCase())) {
        addScore(term, 0.55);
      }
    }
  }

  const termStatMap = new Map(termStats.map((item) => [item.key, item]));
  const rawCandidates = Array.from(keywordScores.values()).map((item) => {
    const stat = termStatMap.get(normalizeTermKey(item.term));
    const coverage = stat ? stat.docCount / searchItems.length : 0;
    return {
      term: item.term,
      score: item.score,
      coverage,
    };
  });

  const filteredCandidates = rawCandidates.filter((item) => {
    if (/^\d+$/.test(item.term)) return false;
    if (/^[a-z0-9+#./_-]+$/i.test(item.term) && item.term.length < 3) return false;
    if (/[\u4e00-\u9fff]/.test(item.term) && item.term.length < 2) return false;
    return item.coverage <= 0.78;
  });

  filteredCandidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.term.length - a.term.length;
  });

  const topScore = filteredCandidates[0]?.score ?? 0;
  const minScore = topScore > 0 ? topScore * 0.2 : 0;
  const selected: Array<{ term: string; score: number }> = [];

  for (const candidate of filteredCandidates) {
    if (candidate.score < minScore) continue;

    const isCovered = selected.some(
      (item) =>
        (item.term.includes(candidate.term) || candidate.term.includes(item.term)) &&
        item.score >= candidate.score * 0.95,
    );

    if (!isCovered) {
      selected.push({ term: candidate.term, score: candidate.score });
    }

    if (selected.length >= 96) break;
  }

  return selected
    .sort((a, b) => b.term.length - a.term.length)
    .map((item) => item.term)
    .slice(0, 72);
}

type ResumeTabValue = "parsed" | "original";

export interface InterviewResumeSnapshot {
  id: string;
  originalFilename: string;
  originalFileUrl: string | null;
  parseStatus: string;
  parsedData: ParsedResume | null;
}

interface InterviewResumeContextSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  snapshot: InterviewResumeSnapshot | null;
  currentQuestion: string;
}

export function InterviewResumeContextSheet({
  open,
  onOpenChange,
  snapshot,
  currentQuestion,
}: InterviewResumeContextSheetProps) {
  const { t } = useTranslation();
  const hasParsedSnapshot = Boolean(snapshot?.parsedData);
  const hasOriginalSnapshot = Boolean(snapshot?.originalFileUrl);
  const parsedSnapshot = snapshot?.parsedData ?? null;
  const [activeTab, setActiveTab] = useState<ResumeTabValue>("parsed");
  const resolvedTab: ResumeTabValue = hasParsedSnapshot
    ? activeTab
    : "original";

  const keywords = useMemo(
    () =>
      parsedSnapshot
        ? extractKeywordsWithFuse(currentQuestion, parsedSnapshot)
        : [],
    [currentQuestion, parsedSnapshot],
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-4xl">
        <SheetHeader className="gap-2 border-b px-5 py-4">
          <SheetTitle className="flex items-center gap-2">
            <FileText className="size-4 text-primary" />
            {t.interview.resumeContext}
          </SheetTitle>
        </SheetHeader>

        <Tabs
          value={resolvedTab}
          onValueChange={(value) => setActiveTab(value as ResumeTabValue)}
          className="flex min-h-0 flex-1 flex-col gap-0"
        >
          <div className="border-b px-5 py-3">
            <TabsList>
              <TabsTrigger value="parsed" disabled={!hasParsedSnapshot}>
                {t.interview.parsedResume}
              </TabsTrigger>
              <TabsTrigger value="original" disabled={!hasOriginalSnapshot}>
                {t.interview.originalResume}
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="parsed" className="mt-0 flex min-h-0 flex-1">
            <ScrollArea className="min-h-0 flex-1">
              <div className="mx-auto flex w-full max-w-[980px] flex-col gap-4 px-5 py-5">
                {currentQuestion && keywords.length > 0 && (
                  <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    <Sparkles className="size-3.5" />
                    <span>{t.interview.highlightRelatedContent}</span>
                  </div>
                )}

                {snapshot?.parsedData ? (
                  <ParsedResumePreview
                    parsed={snapshot.parsedData}
                    highlightKeywords={keywords}
                    className="max-w-none"
                  />
                ) : (
                  <div className="rounded-lg border border-dashed bg-card p-6 text-sm text-muted-foreground">
                    {t.interview.parsedResumeUnavailable}
                  </div>
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="original" className="mt-0 flex min-h-0 flex-1">
            <ScrollArea className="min-h-0 flex-1">
              <div className="mx-auto w-full max-w-[980px] px-5 py-5">
                {snapshot?.originalFileUrl ? (
                  <ResumePdfPreview
                    key={snapshot.originalFileUrl}
                    fileUrl={snapshot.originalFileUrl}
                    filename={snapshot.originalFilename}
                  />
                ) : (
                  <div className="rounded-lg border border-dashed bg-card p-6 text-sm text-muted-foreground">
                    {t.interview.originalResumeUnavailable}
                  </div>
                )}
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
