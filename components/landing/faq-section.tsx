"use client";

import { useState } from "react";
import { ChevronDown, HelpCircle, Sparkles } from "lucide-react";
import { useTranslation } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

export function FaqSection() {
  const { t } = useTranslation();
  const faq = t.landing.faq;
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  const toggleItem = (idx: number) => {
    setOpenIndex((prev) => (prev === idx ? null : idx));
  };

  return (
    <section id="faq" className="py-24 sm:py-32 relative bg-muted/20 border-t border-border/60">
      <div className="mx-auto max-w-5xl px-6">
        {/* Header */}
        <div className="mx-auto max-w-3xl text-center mb-14 sm:mb-18">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/[0.05] px-3.5 py-1 text-xs font-semibold text-primary mb-4">
            <HelpCircle className="size-3.5" />
            <span>{faq.badge}</span>
          </div>
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl lg:text-5xl text-balance">
            {faq.title}
          </h2>
          <p className="mt-4 text-base sm:text-lg text-muted-foreground leading-relaxed text-balance">
            {faq.subtitle}
          </p>
        </div>

        {/* FAQ Accordion List */}
        <div className="mx-auto max-w-3xl space-y-4">
          {faq.items.map((item, idx) => {
            const isOpen = openIndex === idx;

            return (
              <div
                key={idx}
                className={cn(
                  "overflow-hidden rounded-2xl border transition-all duration-200",
                  isOpen
                    ? "border-primary/40 bg-card shadow-md ring-1 ring-primary/20"
                    : "border-border/80 bg-card/60 hover:bg-card hover:border-border",
                )}
              >
                <button
                  type="button"
                  onClick={() => toggleItem(idx)}
                  className="flex w-full cursor-pointer items-center justify-between gap-4 p-5 text-left transition-colors"
                  aria-expanded={isOpen}
                >
                  <span className="text-base sm:text-lg font-bold text-foreground">
                    {item.question}
                  </span>
                  <div
                    className={cn(
                      "flex size-7 shrink-0 items-center justify-center rounded-full transition-transform duration-200",
                      isOpen
                        ? "rotate-180 bg-primary/10 text-primary"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    <ChevronDown className="size-4" />
                  </div>
                </button>

                {isOpen && (
                  <div className="border-t border-border/50 bg-background/50 px-5 pb-5 pt-3">
                    <p className="text-sm sm:text-base leading-relaxed text-muted-foreground">
                      {item.answer}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Bottom micro-card */}
        <div className="mt-12 text-center">
          <div className="inline-flex items-center gap-2 text-xs text-muted-foreground">
            <Sparkles className="size-3.5 text-primary" />
            <span>{faq.bottomNote}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
