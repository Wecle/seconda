import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { BLOG_POSTS, getBlogPostBySlug } from "@/lib/blog/posts";
import { MarketingNav } from "@/components/marketing/marketing-nav";
import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { Markdown } from "@/components/ui/markdown";
import { Badge } from "@/components/ui/badge";
import {
  Calendar,
  Clock,
  ChevronRight,
  ArrowLeft,
  ArrowRight,
  Sparkles,
} from "lucide-react";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  return BLOG_POSTS.map((post) => ({
    slug: post.slug,
  }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = getBlogPostBySlug(slug);

  if (!post) {
    return {
      title: "文章未找到",
    };
  }

  const siteUrl = process.env.NEXT_PUBLIC_APP_URL || "https://seconda.cn";
  const canonicalUrl = `${siteUrl}/blog/${post.slug}`;

  return {
    title: `${post.title} | Seconda 求职指南`,
    description: post.description,
    keywords: post.tags,
    alternates: {
      canonical: canonicalUrl,
    },
    openGraph: {
      type: "article",
      title: post.title,
      description: post.description,
      url: canonicalUrl,
      publishedTime: post.publishedAt,
      authors: [post.author.name],
      tags: post.tags,
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description: post.description,
    },
  };
}

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params;
  const post = getBlogPostBySlug(slug);

  if (!post) {
    notFound();
  }

  const siteUrl = process.env.NEXT_PUBLIC_APP_URL || "https://seconda.cn";
  const postUrl = `${siteUrl}/blog/${post.slug}`;

  // JSON-LD Structured Data
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.description,
    datePublished: post.publishedAt,
    dateModified: post.updatedAt || post.publishedAt,
    author: {
      "@type": "Organization",
      name: post.author.name,
    },
    publisher: {
      "@type": "Organization",
      name: "Seconda",
      logo: {
        "@type": "ImageObject",
        url: `${siteUrl}/logo.png`,
      },
    },
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": postUrl,
    },
    keywords: post.tags.join(", "),
  };

  const relatedPosts = BLOG_POSTS.filter((p) => p.slug !== post.slug).slice(0, 2);

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col selection:bg-primary/20 selection:text-primary">
      {/* Schema.org Article Structured Data */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <MarketingNav />

      <main className="flex-1 py-12 sm:py-16">
        <article className="mx-auto max-w-4xl px-6">
          {/* Breadcrumb Navigation */}
          <nav
            aria-label="Breadcrumb"
            className="flex items-center gap-1.5 text-xs text-muted-foreground mb-8"
          >
            <Link href="/" className="hover:text-foreground transition-colors">
              首页
            </Link>
            <ChevronRight className="size-3.5 opacity-50" />
            <Link href="/blog" className="hover:text-foreground transition-colors">
              求职指南
            </Link>
            <ChevronRight className="size-3.5 opacity-50" />
            <span className="text-foreground font-medium truncate max-w-[240px] sm:max-w-md">
              {post.title}
            </span>
          </nav>

          {/* Article Header */}
          <header className="mb-10 pb-8 border-b border-border/70">
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <Badge variant="default" className="bg-primary text-primary-foreground">
                {post.category}
              </Badge>
              {post.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-md bg-secondary px-2 py-0.5 text-xs text-secondary-foreground"
                >
                  #{tag}
                </span>
              ))}
            </div>

            <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl lg:text-5xl text-foreground text-balance leading-tight">
              {post.title}
            </h1>

            <p className="mt-4 text-base sm:text-lg text-muted-foreground leading-relaxed text-balance">
              {post.description}
            </p>

            {/* Author & Meta */}
            <div className="mt-6 flex flex-wrap items-center justify-between gap-4 pt-6 border-t border-border/40 text-xs text-muted-foreground">
              <div className="flex items-center gap-3">
                <div className="size-9 rounded-full bg-primary/10 flex items-center justify-center font-bold text-primary text-sm">
                  S
                </div>
                <div>
                  <div className="font-semibold text-foreground">{post.author.name}</div>
                  <div>{post.author.role}</div>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <span className="flex items-center gap-1">
                  <Calendar className="size-3.5" />
                  {post.publishedAt}
                </span>
                <span>·</span>
                <span className="flex items-center gap-1">
                  <Clock className="size-3.5" />
                  {post.readTime}
                </span>
              </div>
            </div>
          </header>

          {/* Article Body */}
          <div className="prose prose-slate dark:prose-invert max-w-none text-base leading-relaxed">
            <Markdown content={post.content} />
          </div>

          {/* Conversion CTA Card */}
          <div className="my-14 rounded-3xl border border-primary/30 bg-gradient-to-br from-card via-card to-primary/[0.08] p-8 sm:p-10 shadow-lg text-center">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary mb-3">
              <Sparkles className="size-3.5" />
              <span>真枪实战检验学习成果</span>
            </div>
            <h3 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              准备好在 AI 模拟面试中实操这些技巧了吗？
            </h3>
            <p className="mt-2.5 max-w-lg mx-auto text-sm text-muted-foreground leading-relaxed">
              上传你的真实简历，体验 Seconda 基于你项目事实的连环自适应追问，获取完整的六维能力报告与复盘建议。
            </p>
            <div className="mt-6">
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-7 py-3 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/25 hover:bg-primary/90 transition-all active:scale-[0.98]"
              >
                <span>免费开始模拟对练</span>
                <ArrowRight className="size-4" />
              </Link>
            </div>
          </div>

          {/* Bottom Nav & Related Articles */}
          <footer className="pt-8 border-t border-border/70">
            <div className="flex items-center justify-between mb-8">
              <Link
                href="/blog"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowLeft className="size-4" />
                <span>返回所有指南</span>
              </Link>
            </div>

            {/* Related Posts */}
            {relatedPosts.length > 0 && (
              <div>
                <h4 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-4">
                  推荐阅读
                </h4>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {relatedPosts.map((related) => (
                    <Link
                      key={related.slug}
                      href={`/blog/${related.slug}`}
                      className="group block rounded-xl border border-border/80 bg-card p-5 transition-all hover:border-primary/40 hover:shadow-sm"
                    >
                      <span className="text-xs text-primary font-medium">
                        {related.category}
                      </span>
                      <h5 className="mt-1 text-sm font-bold text-foreground group-hover:text-primary transition-colors line-clamp-2">
                        {related.title}
                      </h5>
                      <span className="mt-3 inline-flex items-center gap-1 text-xs text-muted-foreground font-medium">
                        阅读
                        <ArrowRight className="size-3" />
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </footer>
        </article>
      </main>

      <MarketingFooter />
    </div>
  );
}
