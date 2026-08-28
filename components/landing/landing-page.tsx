"use client";

import Link from "next/link";
import { ArrowRight, Sparkles, Zap } from "lucide-react";
import { useTranslation } from "@/lib/i18n/context";
import { AuthRequiredLink } from "@/components/auth/auth-required-link";
import { BrandIcon } from "@/components/brand/brand-icon";
import { StartInterviewButton } from "@/components/auth/start-interview-button";
import { UserAvatarMenu } from "@/components/auth/user-avatar-menu";
import { LanguageSwitcher } from "@/components/language-switcher";
import { HeroMockup } from "@/components/landing/hero-mockup";
import { BentoFeatures } from "@/components/landing/bento-features";
import { DimensionMatrix } from "@/components/landing/dimension-matrix";
import { InteractiveJourney } from "@/components/landing/interactive-journey";
import { FaqSection } from "@/components/landing/faq-section";

interface LandingPageProps {
  isAuthenticated: boolean;
  currentUser: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
  } | null;
}

export function LandingPage({ isAuthenticated, currentUser }: LandingPageProps) {
  const { t } = useTranslation();
  const landing = t.landing;

  return (
    <div className="min-h-screen bg-background text-foreground selection:bg-primary/20 selection:text-primary">
      {/* Navigation */}
      <nav className="sticky top-0 z-50 border-b border-border/80 bg-background/80 backdrop-blur-xl transition-all">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link
            href="/"
            className="flex items-center gap-2.5 text-lg font-bold tracking-tight text-foreground transition-opacity hover:opacity-90"
          >
            <BrandIcon size={28} priority />
            <span className="font-sans font-bold">Seconda</span>
          </Link>

          {/* Center Navigation Links (Hidden on small screens) */}
          <div className="hidden md:flex items-center gap-8 text-sm font-medium text-muted-foreground">
            <Link
              href="#features"
              className="transition-colors hover:text-foreground"
            >
              {landing.bento.badge}
            </Link>
            <Link
              href="#dimensions"
              className="transition-colors hover:text-foreground"
            >
              {landing.dimensions.badge}
            </Link>
            <Link
              href="#journey"
              className="transition-colors hover:text-foreground"
            >
              {landing.journey.badge}
            </Link>
            <Link
              href="#faq"
              className="transition-colors hover:text-foreground"
            >
              {landing.faq.badge}
            </Link>
          </div>

          {/* Right Action Menu */}
          <div className="flex items-center gap-4 sm:gap-5">
            <LanguageSwitcher />

            {isAuthenticated && currentUser ? (
              <UserAvatarMenu user={currentUser} />
            ) : (
              <AuthRequiredLink
                isAuthenticated={false}
                href="/dashboard"
                className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                {t.common.login}
              </AuthRequiredLink>
            )}

            <StartInterviewButton
              isAuthenticated={isAuthenticated}
              size="sm"
              className="font-medium shadow-xs transition-transform active:scale-[0.98]"
            >
              {landing.startUsing}
            </StartInterviewButton>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative overflow-hidden pt-20 pb-24 sm:pt-28 sm:pb-32">
        {/* Background Ambient Mesh & Radial Glow */}
        <div
          className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
          aria-hidden="true"
        >
          <div className="absolute left-1/2 -top-[100px] -translate-x-1/2 h-[500px] w-[800px] rounded-full bg-gradient-to-tr from-primary/15 via-blue-500/10 to-indigo-500/10 blur-[130px]" />
          <div
            className="absolute inset-0 opacity-[0.03]"
            style={{
              backgroundImage:
                "radial-gradient(circle, currentColor 1px, transparent 1px)",
              backgroundSize: "36px 36px",
            }}
          />
        </div>

        <div className="mx-auto flex max-w-5xl flex-col items-center px-6 text-center">
          {/* Badge */}
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/[0.06] px-4 py-1.5 text-xs font-semibold text-primary shadow-xs backdrop-blur-md">
            <Sparkles className="size-3.5 animate-pulse" />
            <span>{landing.badge}</span>
          </div>

          {/* Main Display Headline (Banned narrow multi-line wrap, wide typography) */}
          <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl md:text-6xl lg:text-7xl leading-[1.12] text-balance">
            {landing.heroTitle1}
            <br />
            <span className="bg-gradient-to-r from-primary via-blue-600 to-indigo-600 bg-clip-text text-transparent">
              {landing.heroTitle2}
            </span>
          </h1>

          {/* Subtitle */}
          <p className="mt-6 max-w-2xl text-base sm:text-lg leading-relaxed text-muted-foreground text-balance">
            {landing.heroDescription}
          </p>

          {/* CTA with tactile feedback */}
          <div className="mt-10 flex items-center justify-center">
            <StartInterviewButton
              isAuthenticated={isAuthenticated}
              size="lg"
              className="gap-2 px-8 text-base font-semibold shadow-lg shadow-primary/25 transition-all duration-200 hover:shadow-primary/35 hover:-translate-y-0.5 active:scale-[0.98]"
            >
              {landing.startButton}
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </StartInterviewButton>
          </div>

          {/* Trust / Quantitative Metrics Bar */}
          <div className="mt-14 grid w-full max-w-3xl grid-cols-2 gap-4 rounded-2xl border border-border/80 bg-card/60 p-4 backdrop-blur-md sm:grid-cols-4">
            <div className="flex flex-col items-center p-2">
              <span className="font-mono text-2xl font-black text-foreground">
                {landing.stats.grounded.value}
              </span>
              <span className="text-xs text-muted-foreground mt-0.5">
                {landing.stats.grounded.label}
              </span>
            </div>
            <div className="flex flex-col items-center p-2 border-l border-border/50 sm:border-l">
              <span className="font-mono text-2xl font-black text-foreground">
                {landing.stats.dimensions.value}
              </span>
              <span className="text-xs text-muted-foreground mt-0.5">
                {landing.stats.dimensions.label}
              </span>
            </div>
            <div className="flex flex-col items-center p-2 border-t border-border/50 sm:border-t-0 sm:border-l">
              <span className="font-mono text-2xl font-black text-foreground">
                {landing.stats.scoring.value}
              </span>
              <span className="text-xs text-muted-foreground mt-0.5">
                {landing.stats.scoring.label}
              </span>
            </div>
            <div className="flex flex-col items-center p-2 border-t border-l border-border/50 sm:border-t-0">
              <span className="font-mono text-2xl font-black text-foreground">
                {landing.stats.speed.value}
              </span>
              <span className="text-xs text-muted-foreground mt-0.5">
                {landing.stats.speed.label}
              </span>
            </div>
          </div>
        </div>

        {/* Hero Mockup Live Preview */}
        <div className="mt-16 sm:mt-20 px-4 sm:px-6">
          <HeroMockup />
        </div>
      </section>

      {/* Asymmetric Bento Features */}
      <BentoFeatures />

      {/* 6-Dimension Score Matrix */}
      <div id="dimensions">
        <DimensionMatrix />
      </div>

      {/* Interactive 4-Step Journey */}
      <div id="journey">
        <InteractiveJourney />
      </div>

      {/* FAQ Section */}
      <FaqSection />

      {/* Magnetic High-Contrast CTA Section */}
      <section className="py-24 sm:py-32 relative">
        <div className="mx-auto max-w-5xl px-6">
          <div className="relative overflow-hidden rounded-3xl border border-primary/30 bg-gradient-to-b from-card via-card/95 to-card p-8 sm:p-14 text-center shadow-2xl">
            {/* Ambient inner glow */}
            <div
              className="pointer-events-none absolute inset-0 -z-10"
              aria-hidden="true"
            >
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-[350px] w-[500px] rounded-full bg-primary/10 blur-[90px]" />
            </div>

            <div className="relative mx-auto max-w-2xl space-y-4">
              <div className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3.5 py-1 text-xs font-semibold text-primary">
                <Zap className="size-3.5" />
                <span>立即开始实战对练</span>
              </div>

              <h2 className="text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl lg:text-5xl text-balance">
                {landing.ctaTitle}
              </h2>

              <p className="text-base sm:text-lg text-muted-foreground leading-relaxed text-balance">
                {landing.ctaDescription}
              </p>

              <div className="pt-4 flex flex-col sm:flex-row items-center justify-center gap-4">
                <StartInterviewButton
                  isAuthenticated={isAuthenticated}
                  size="lg"
                  className="gap-2 px-8 text-base font-semibold shadow-lg shadow-primary/25 transition-all duration-200 hover:shadow-primary/35 hover:-translate-y-0.5 active:scale-[0.98]"
                >
                  {landing.freeStart}
                  <ArrowRight className="size-4" />
                </StartInterviewButton>
              </div>

              <p className="text-xs text-muted-foreground/80 pt-2">
                {landing.ctaHint}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Polished Footer */}
      <footer className="border-t border-border/80 bg-card/40 py-12">
        <div className="mx-auto max-w-6xl px-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6 pb-8 border-b border-border/50">
            <Link
              href="/"
              className="flex items-center gap-2.5 text-base font-bold text-foreground"
            >
              <BrandIcon size={24} />
              <span>Seconda</span>
            </Link>

            <div className="flex flex-wrap items-center justify-center gap-8 text-xs sm:text-sm text-muted-foreground">
              <Link
                href="#features"
                className="transition-colors hover:text-foreground"
              >
                {landing.bento.badge}
              </Link>
              <Link
                href="#dimensions"
                className="transition-colors hover:text-foreground"
              >
                {landing.dimensions.badge}
              </Link>
              <Link
                href="#journey"
                className="transition-colors hover:text-foreground"
              >
                {landing.journey.badge}
              </Link>
              <Link
                href="#faq"
                className="transition-colors hover:text-foreground"
              >
                {landing.faq.badge}
              </Link>
              <Link
                href="#"
                className="transition-colors hover:text-foreground"
              >
                {landing.footer.privacy}
              </Link>
              <Link
                href="#"
                className="transition-colors hover:text-foreground"
              >
                {landing.footer.terms}
              </Link>
              <Link
                href="mailto:zyx19981379@gmail.com"
                className="transition-colors hover:text-foreground"
              >
                {landing.footer.contact}
              </Link>
            </div>
          </div>

          <div className="mt-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-muted-foreground">
            <p>{landing.footer.copyright}</p>
            <p className="font-mono text-[11px]">
              Engineered with Impeccable & Taste Standards
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
