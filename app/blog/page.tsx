import type { Metadata } from "next";
import Link from "next/link";
import { BLOG_POSTS, getAllBlogCategories } from "@/lib/blog/posts";
import { MarketingNav } from "@/components/marketing/marketing-nav";
import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { BookOpen, Clock, Calendar, ArrowRight, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = {
  title: "求职指南与技术面试深度博客 | Seconda",
  description:
    "汇集一线大厂技术面试通关策略、STAR 法则实战应用、自适应深度追问应对心法与高通过率技术简历撰写指南。用科学框架击碎八股文迷局。",
  alternates: {
    canonical: "/blog",
  },
  openGraph: {
    title: "求职指南与技术面试深度博客 | Seconda",
    description:
      "汇集一线大厂技术面试通关策略、STAR 法则实战应用与高通过率技术简历打造秘籍。",
    url: "/blog",
  },
};

export default function BlogIndexPage() {
  const [featuredPost, ...otherPosts] = BLOG_POSTS;
  const categories = getAllBlogCategories();

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col selection:bg-primary/20 selection:text-primary">
      <MarketingNav />

      <main className="flex-1 py-14 sm:py-20">
        <div className="mx-auto max-w-6xl px-6">
          {/* Header Banner */}
          <div className="mx-auto max-w-3xl text-center mb-16">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/[0.06] px-4 py-1.5 text-xs font-semibold text-primary mb-4 shadow-xs">
              <Sparkles className="size-3.5" />
              <span>技术面试与求职实战智库</span>
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight sm:text-5xl text-foreground text-balance">
              Seconda 求职指南与干货专栏
            </h1>
            <p className="mt-4 text-base sm:text-lg text-muted-foreground leading-relaxed text-balance">
              告别模板化死记硬背。从简历撰写、STAR 结构化表达、自适应深度追问到大厂行为面试，助你在顶级面试中脱颖而出。
            </p>

            {/* Category Tags Bar */}
            <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
              <span className="text-xs text-muted-foreground mr-1">分类导航：</span>
              {categories.map((cat) => (
                <span
                  key={cat}
                  className="rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground"
                >
                  {cat}
                </span>
              ))}
            </div>
          </div>

          {/* Featured Post */}
          {featuredPost && (
            <div className="mb-14">
              <Link
                href={`/blog/${featuredPost.slug}`}
                className="group relative block overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-br from-card via-card to-primary/[0.04] p-8 sm:p-10 shadow-lg transition-all duration-300 hover:border-primary/50 hover:shadow-xl hover:-translate-y-0.5"
              >
                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground mb-4">
                  <Badge variant="default" className="bg-primary text-primary-foreground">
                    精选专栏
                  </Badge>
                  <span className="font-semibold text-primary">{featuredPost.category}</span>
                  <span>·</span>
                  <span className="flex items-center gap-1">
                    <Calendar className="size-3" />
                    {featuredPost.publishedAt}
                  </span>
                  <span>·</span>
                  <span className="flex items-center gap-1">
                    <Clock className="size-3" />
                    {featuredPost.readTime}
                  </span>
                </div>

                <h2 className="text-2xl font-bold tracking-tight sm:text-3xl text-foreground group-hover:text-primary transition-colors text-balance">
                  {featuredPost.title}
                </h2>

                <p className="mt-4 text-sm sm:text-base text-muted-foreground leading-relaxed text-balance">
                  {featuredPost.description}
                </p>

                <div className="mt-6 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{featuredPost.author.name}</span>
                    <span>·</span>
                    <span>{featuredPost.author.role}</span>
                  </div>

                  <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary transition-transform group-hover:translate-x-1">
                    阅读全文
                    <ArrowRight className="size-4" />
                  </span>
                </div>
              </Link>
            </div>
          )}

          {/* Article Grid */}
          <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
            {otherPosts.map((post) => (
              <Link
                key={post.slug}
                href={`/blog/${post.slug}`}
                className="group flex flex-col justify-between rounded-2xl border border-border/80 bg-card p-6 shadow-xs transition-all duration-200 hover:border-primary/40 hover:shadow-md hover:-translate-y-0.5"
              >
                <div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground mb-3">
                    <Badge variant="secondary" className="font-medium">
                      {post.category}
                    </Badge>
                    <span className="flex items-center gap-1">
                      <Clock className="size-3" />
                      {post.readTime}
                    </span>
                  </div>

                  <h3 className="text-lg font-bold text-foreground group-hover:text-primary transition-colors line-clamp-2">
                    {post.title}
                  </h3>

                  <p className="mt-2.5 text-xs text-muted-foreground leading-relaxed line-clamp-3">
                    {post.description}
                  </p>
                </div>

                <div className="mt-6 pt-4 border-t border-border/50 flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{post.publishedAt}</span>
                  <span className="font-semibold text-primary inline-flex items-center gap-1 group-hover:translate-x-0.5 transition-transform">
                    阅读
                    <ArrowRight className="size-3" />
                  </span>
                </div>
              </Link>
            ))}
          </div>

          {/* Bottom Conversion Banner */}
          <div className="mt-20 rounded-3xl border border-primary/30 bg-gradient-to-r from-primary/10 via-card to-primary/10 p-8 sm:p-12 text-center shadow-xl">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
              只读干货还不够？在真实场景中检验自己
            </h2>
            <p className="mt-3 max-w-xl mx-auto text-sm text-muted-foreground">
              上传你的 PDF 简历，让 AI 面试官为你开启自适应连环追问与六维能力打分。
            </p>
            <div className="mt-6 flex justify-center">
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/25 hover:bg-primary/90 transition-all active:scale-[0.98]"
              >
                <BookOpen className="size-4" />
                <span>立即开启 AI 模拟实战</span>
              </Link>
            </div>
          </div>
        </div>
      </main>

      <MarketingFooter />
    </div>
  );
}
