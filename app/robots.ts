import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/dashboard", "/agent", "/interviews"],
      },
      {
        userAgent: [
          "GPTBot",
          "ChatGPT-User",
          "PerplexityBot",
          "ClaudeBot",
          "anthropic-ai",
          "Google-Extended",
          "Applebot-Extended",
          "Bingbot",
          "Bytespider",
          "Baiduspider",
        ],
        allow: "/",
        disallow: ["/api/", "/dashboard", "/agent", "/interviews"],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
