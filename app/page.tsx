import Link from "next/link";
import { FileText, Brain, Target, ArrowRight } from "lucide-react";
import { auth } from "@/auth";
import { AuthRequiredLink } from "@/components/auth/auth-required-link";
import { BrandIcon } from "@/components/brand/brand-icon";
import { StartInterviewButton } from "@/components/auth/start-interview-button";
import { UserAvatarMenu } from "@/components/auth/user-avatar-menu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const features = [
  {
    icon: FileText,
    title: "简历驱动",
    description: "基于你的真实简历生成面试题，每一道题都与你的经历高度相关",
  },
  {
    icon: Brain,
    title: "六维评分",
    description: "从理解力、表达力、逻辑性等六个维度给出精准评分与改进建议",
  },
  {
    icon: Target,
    title: "深度复盘",
    description: "支持追问模式与教练模式，从错误中彻底掌握知识点",
  },
];

const steps = [
  {
    number: "01",
    title: "上传简历",
    description: "上传 PDF 简历，AI 自动解析为结构化数据",
  },
  {
    number: "02",
    title: "配置面试",
    description: "选择面试类型、难度、语言和面试官风格",
  },
  {
    number: "03",
    title: "模拟面试",
    description: "逐题作答，获得实时反馈和追问",
  },
  {
    number: "04",
    title: "查看报告",
    description: "获取详细评分报告和针对性改进建议",
  },
];

export default async function Home() {
  const session = await auth();
  const currentUser = session?.user ?? null;
  const isAuthenticated = Boolean(session?.user?.id);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Navigation */}
      <nav className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link
            href="/"
            className="flex items-center gap-2 text-xl font-bold tracking-tight"
          >
            <BrandIcon size={28} priority />
            <span>Seconda</span>
          </Link>
          <div className="flex items-center gap-6">
            {isAuthenticated && currentUser ? (
              <UserAvatarMenu user={currentUser} />
            ) : (
              <AuthRequiredLink
                isAuthenticated={false}
                href="/dashboard"
                className="text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                登录
              </AuthRequiredLink>
            )}
            <StartInterviewButton isAuthenticated={isAuthenticated} size="sm">
              开始使用
            </StartInterviewButton>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0"
          aria-hidden="true"
        >
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-[600px] w-[600px] rounded-full bg-primary/[0.06] blur-[120px]" />
          <div
            className="absolute inset-0 opacity-[0.03]"
            style={{
              backgroundImage:
                "radial-gradient(circle, currentColor 1px, transparent 1px)",
              backgroundSize: "32px 32px",
            }}
          />
        </div>

        <div className="relative mx-auto flex max-w-4xl flex-col items-center px-6 py-32 text-center">
          <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/[0.05] px-4 py-1.5 text-sm text-primary">
            <span
              className="inline-block h-1.5 w-1.5 rounded-full bg-primary"
              aria-hidden="true"
            />
            AI 驱动的模拟面试
          </div>

          <h1 className="text-5xl font-bold tracking-tight md:text-6xl lg:text-7xl">
            每一次面试，
            <br />
            <span className="text-primary">都是一次跃迁</span>
          </h1>

          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
            基于简历的定制化面试、结构化评分与 AI
            深度反馈，助你在真实面试中脱颖而出
          </p>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <StartInterviewButton
              isAuthenticated={isAuthenticated}
              size="lg"
              className="gap-2 px-6"
            >
              开始模拟面试
              <ArrowRight className="size-4" />
            </StartInterviewButton>
            <Button asChild variant="outline" size="lg" className="px-6">
              <Link href="#features">了解更多</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-6xl px-6 py-24">
        <h2 className="mb-16 text-center text-3xl font-bold tracking-tight">
          为面试者精心设计
        </h2>
        <div className="grid gap-6 md:grid-cols-3">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="group rounded-xl border bg-card p-8 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg"
            >
              <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors duration-300 group-hover:bg-primary group-hover:text-primary-foreground">
                <feature.icon className="size-5" />
              </div>
              <h3 className="mb-2 text-lg font-semibold">{feature.title}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="bg-card py-24">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="mb-16 text-center text-3xl font-bold tracking-tight">
            四步开启你的面试训练
          </h2>
          <div className="grid gap-px overflow-hidden rounded-2xl border bg-border md:grid-cols-4">
            {steps.map((step, i) => (
              <div
                key={step.number}
                className={cn(
                  "relative bg-card p-8 transition-colors hover:bg-accent/50",
                )}
              >
                <span className="mb-4 block font-mono text-3xl font-bold text-primary/25">
                  {step.number}
                </span>
                <h3 className="mb-2 font-semibold">{step.title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {step.description}
                </p>
                {i < steps.length - 1 && (
                  <ArrowRight className="absolute right-4 top-8 hidden size-4 text-muted-foreground/40 md:block" />
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24">
        <div className="relative mx-auto max-w-6xl px-6">
          <div className="relative overflow-hidden rounded-2xl border bg-card px-8 py-16 text-center">
            <div
              className="pointer-events-none absolute inset-0"
              aria-hidden="true"
            >
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-[300px] w-[500px] rounded-full bg-primary/[0.05] blur-[80px]" />
            </div>
            <div className="relative">
              <h2 className="text-3xl font-bold tracking-tight">
                准备好了吗？
              </h2>
              <p className="mt-3 text-muted-foreground">
                现在就开始你的第一场模拟面试
              </p>
              <div className="mt-8">
                <StartInterviewButton
                  isAuthenticated={isAuthenticated}
                  size="lg"
                  className="gap-2 px-8"
                >
                  免费开始
                  <ArrowRight className="size-4" />
                </StartInterviewButton>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 text-sm text-muted-foreground md:flex-row">
          <p>&copy; 2026 Seconda. All rights reserved.</p>
          <div className="flex gap-6">
            <Link href="#" className="transition-colors hover:text-foreground">
              隐私政策
            </Link>
            <Link href="#" className="transition-colors hover:text-foreground">
              使用条款
            </Link>
            <Link href="#" className="transition-colors hover:text-foreground">
              联系我们
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
