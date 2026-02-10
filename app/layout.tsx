import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { cookies } from "next/headers";
import { I18nProvider } from "@/lib/i18n/context";
import { defaultLocale, isLocale, localeCookieName } from "@/lib/i18n";
import "./globals.css";

const inter = Inter({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Seconda | AI Mock Interview",
    template: "%s | Seconda",
  },
  description: "AI-powered mock interview system with structured scoring and deep review",
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
        <I18nProvider initialLocale={initialLocale}>{children}</I18nProvider>
      </body>
    </html>
  );
}
