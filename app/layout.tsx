import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { cookies } from "next/headers";
import { I18nProvider } from "@/lib/i18n/context";
import { defaultLocale, isLocale, localeCookieName } from "@/lib/i18n";
import { Toaster } from "@/components/ui/sonner";
import { StructuredData } from "@/components/seo/structured-data";
import "./globals.css";

const inter = Inter({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const siteUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Seconda — AI 驱动的高拟真模拟面试系统 | 简历事实锚定与六维能力评估",
    template: "%s | Seconda",
  },
  description:
    "Seconda 是基于简历事实深度锚定、自适应多轮追问与六维能力模型（理解力、表达力、逻辑性、深度、真实性、反思力）的 AI 模拟面试平台。告别模板化八股文，助你在顶级技术面试中从容胜出。",
  keywords: [
    "AI模拟面试",
    "AI 面试官",
    "AI Mock Interview",
    "简历解析面试",
    "六维能力评估",
    "前端面试",
    "架构师面试",
    "技术面试对练",
    "STAR法则",
    "行为面试",
    "Seconda",
  ],
  authors: [{ name: "Seconda Team" }],
  creator: "Seconda",
  publisher: "Seconda",
  alternates: {
    canonical: "/",
    languages: {
      "zh-CN": "/",
      "en-US": "/?lang=en",
    },
  },
  openGraph: {
    type: "website",
    locale: "zh_CN",
    alternateLocale: ["en_US"],
    url: siteUrl,
    title: "Seconda — AI 驱动的高拟真模拟面试系统",
    description:
      "基于简历事实深度锚定、自适应多轮追问与六维能力模型，告别模板化八股文，开启真正的深度对练。",
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
    title: "Seconda — AI 驱动的高拟真模拟面试系统",
    description:
      "基于简历事实深度锚定、自适应多轮追问与六维能力模型，助你在顶级技术面试中从容胜出。",
    images: ["/logo.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  icons: {
    icon: "/logo.png",
    shortcut: "/logo.png",
    apple: "/logo.png",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(localeCookieName)?.value;
  const initialLocale = isLocale(cookieLocale) ? cookieLocale : defaultLocale;

  return (
    <html lang={initialLocale}>
      <body className={`${inter.variable} antialiased font-sans`}>
        <I18nProvider initialLocale={initialLocale}>
          <StructuredData />
          {children}
          <Toaster />
        </I18nProvider>
      </body>
    </html>
  );
}
