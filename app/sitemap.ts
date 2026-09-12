import type { MetadataRoute } from "next";
import { BLOG_POSTS } from "@/lib/blog/posts";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://seconda.cn";
  const now = new Date();

  const blogPostEntries: MetadataRoute.Sitemap = BLOG_POSTS.map((post) => ({
    url: `${baseUrl}/blog/${post.slug}`,
    lastModified: new Date(post.updatedAt || post.publishedAt),
    changeFrequency: "weekly",
    priority: 0.8,
  }));

  return [
    {
      url: `${baseUrl}/`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1.0,
      alternates: {
        languages: {
          "zh-CN": `${baseUrl}/`,
          "en-US": `${baseUrl}/en`,
          "x-default": `${baseUrl}/`,
        },
      },
    },
    {
      url: `${baseUrl}/en`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.9,
      alternates: {
        languages: {
          "zh-CN": `${baseUrl}/`,
          "en-US": `${baseUrl}/en`,
          "x-default": `${baseUrl}/`,
        },
      },
    },
    {
      url: `${baseUrl}/blog`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.9,
    },
    ...blogPostEntries,
    {
      url: `${baseUrl}/privacy`,
      lastModified: new Date("2026-09-12"),
      changeFrequency: "monthly",
      priority: 0.3,
    },
    {
      url: `${baseUrl}/terms`,
      lastModified: new Date("2026-09-12"),
      changeFrequency: "monthly",
      priority: 0.3,
    },
  ];
}
