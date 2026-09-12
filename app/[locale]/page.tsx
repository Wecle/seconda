import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { I18nProvider } from "@/lib/i18n/context";
import { LandingPage } from "@/components/landing/landing-page";

const siteUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

interface LocalePageProps {
  params: Promise<{ locale: string }>;
}

export function generateStaticParams() {
  return [{ locale: "en" }];
}

export async function generateMetadata({
  params,
}: LocalePageProps): Promise<Metadata> {
  const { locale } = await params;

  if (locale !== "en") {
    return {};
  }

  return {
    title:
      "Seconda — AI-Powered Mock Interview Platform | Resume-Grounded & 6-Dimension Evaluation",
    description:
      "Seconda is an AI mock interview system grounded in real resume facts, featuring adaptive follow-up probing and a 6-dimension evaluation rubric (Understanding, Expression, Logic, Depth, Authenticity, Reflection). No generic trivia—just authentic interview mastery.",
    keywords: [
      "AI mock interview",
      "AI interviewer",
      "resume grounded interview",
      "tech interview prep",
      "STAR method interview",
      "software architect interview",
      "frontend interview practice",
      "Seconda",
    ],
    alternates: {
      canonical: "/en",
      languages: {
        "zh-CN": "/",
        "en-US": "/en",
        "x-default": "/",
      },
    },
    openGraph: {
      type: "website",
      locale: "en_US",
      alternateLocale: ["zh_CN"],
      url: `${siteUrl}/en`,
      title: "Seconda — AI-Powered Mock Interview Platform",
      description:
        "Resume-grounded, adaptive multi-turn AI mock interviews with 6-dimension competency evaluation.",
      siteName: "Seconda",
      images: [
        {
          url: "/logo.png",
          width: 512,
          height: 512,
          alt: "Seconda AI Mock Interview",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "Seconda — AI-Powered Mock Interview Platform",
      description:
        "Resume-grounded, adaptive multi-turn AI mock interviews with 6-dimension competency evaluation.",
      images: ["/logo.png"],
    },
  };
}

export default async function LocalePage({ params }: LocalePageProps) {
  const { locale } = await params;

  if (locale !== "en") {
    notFound();
  }

  const session = await auth();
  const currentUser = session?.user ?? null;
  const isAuthenticated = Boolean(session?.user?.id);

  return (
    <I18nProvider initialLocale="en">
      <LandingPage
        isAuthenticated={isAuthenticated}
        currentUser={currentUser}
      />
    </I18nProvider>
  );
}
