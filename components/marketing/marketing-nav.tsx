"use client";

import Link from "next/link";
import { BrandIcon } from "@/components/brand/brand-icon";
import { StartInterviewButton } from "@/components/auth/start-interview-button";
import { LanguageSwitcher } from "@/components/language-switcher";

interface MarketingNavProps {
  isAuthenticated?: boolean;
}

export function MarketingNav({ isAuthenticated = false }: MarketingNavProps) {
  return (
    <nav className="sticky top-0 z-50 border-b border-border/80 bg-background/80 backdrop-blur-xl transition-all">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link
          href="/"
          className="flex items-center gap-2.5 text-lg font-bold tracking-tight text-foreground transition-opacity hover:opacity-90"
        >
          <BrandIcon size={28} priority />
          <span className="font-sans font-bold">Seconda</span>
        </Link>

        {/* Center Navigation Links */}
        <div className="hidden md:flex items-center gap-8 text-sm font-medium text-muted-foreground">
          <Link
            href="/#features"
            className="transition-colors hover:text-foreground"
          >
            功能特性
          </Link>
          <Link
            href="/#dimensions"
            className="transition-colors hover:text-foreground"
          >
            能力维度
          </Link>
          <Link
            href="/#journey"
            className="transition-colors hover:text-foreground"
          >
            实战流程
          </Link>
          <Link
            href="/blog"
            className="transition-colors hover:text-foreground font-semibold text-foreground/90"
          >
            求职指南
          </Link>
          <Link
            href="/#faq"
            className="transition-colors hover:text-foreground"
          >
            常见问题
          </Link>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-4 sm:gap-5">
          <LanguageSwitcher />

          <Link
            href="/dashboard"
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            进入工作台
          </Link>

          <StartInterviewButton
            isAuthenticated={isAuthenticated}
            size="sm"
            className="font-medium shadow-xs transition-transform active:scale-[0.98]"
          >
            免费开始实战
          </StartInterviewButton>
        </div>
      </div>
    </nav>
  );
}
