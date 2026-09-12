import type { Metadata } from "next";
import { MarketingNav } from "@/components/marketing/marketing-nav";
import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { ShieldCheck, Lock, Trash2, EyeOff } from "lucide-react";

export const metadata: Metadata = {
  title: "隐私政策 — 数据安全与个人信息保护承诺",
  description:
    "Seconda 严格遵循个人信息保护规范。我们承诺用户简历与面试记录完全加密隔离存储，绝不泄露给任何第三方，绝不用于未经授权的公开大模型预训练。",
  alternates: {
    canonical: "/privacy",
  },
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col selection:bg-primary/20 selection:text-primary">
      <MarketingNav />

      <main className="flex-1 py-16 sm:py-24">
        <div className="mx-auto max-w-4xl px-6">
          {/* Header */}
          <div className="mb-12 border-b border-border/70 pb-8">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3.5 py-1 text-xs font-semibold text-primary mb-4">
              <ShieldCheck className="size-3.5" />
              <span>数据安全合规声明</span>
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl text-foreground">
              Seconda 隐私政策
            </h1>
            <p className="mt-3 text-sm text-muted-foreground">
              最近更新日期：2026 年 9 月 12 日 · 生效日期：2026 年 9 月 12 日
            </p>
          </div>

          {/* Core Trust Badges */}
          <div className="mb-12 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-border/80 bg-card/60 p-5 backdrop-blur-xs">
              <Lock className="size-5 text-primary mb-2" />
              <h3 className="text-sm font-bold text-foreground">端到端加密与隔离</h3>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                用户数据与面试会话采用数据库行级权限隔离，敏感资产通过安全签名凭证存储。
              </p>
            </div>
            <div className="rounded-xl border border-border/80 bg-card/60 p-5 backdrop-blur-xs">
              <EyeOff className="size-5 text-primary mb-2" />
              <h3 className="text-sm font-bold text-foreground">绝不外泄与公开训练</h3>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                用户简历及回答内容绝不向任何猎头或第三方泄露，绝不用于任何未经授权的公开模型预训练。
              </p>
            </div>
            <div className="rounded-xl border border-border/80 bg-card/60 p-5 backdrop-blur-xs">
              <Trash2 className="size-5 text-primary mb-2" />
              <h3 className="text-sm font-bold text-foreground">完全数据自主权</h3>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                支持随时在个人控制台中一键彻底删除上传的简历文件、结构化信息及历史面试记录。
              </p>
            </div>
          </div>

          {/* Policy Content */}
          <div className="prose prose-slate dark:prose-invert max-w-none text-sm leading-relaxed space-y-8">
            <section>
              <h2 className="text-xl font-bold text-foreground mb-3">1. 引言与适用范围</h2>
              <p className="text-muted-foreground">
                感谢你信任并使用 Seconda（以下简称“我们”或“本平台”）。Seconda 致力于通过尖端人工智能技术为求职者提供高度拟真的模拟面试与多维评估服务。我们深知个人简历和求职信息的私密性与重要性，本《隐私政策》旨在清晰告知你在使用我们各项服务时，我们如何收集、使用、存储、保护及管理你的个人信息。
              </p>
            </section>

            <section>
              <h2 className="text-xl font-bold text-foreground mb-3">2. 我们收集的信息</h2>
              <p className="text-muted-foreground mb-2">
                为向你提供核心的 AI 模拟面试与评估功能，我们需要收集以下必要信息：
              </p>
              <ul className="list-disc pl-5 space-y-1.5 text-muted-foreground">
                <li>
                  <strong className="text-foreground">账号基础信息</strong>：当你通过邮箱登录或第三方授权（如 GitHub、Google）登录时，我们会收集你的邮箱地址、用户名及公开头像。
                </li>
                <li>
                  <strong className="text-foreground">简历与履历信息</strong>：你上传的 PDF 格式简历文件，或在简历编辑器中手动填写的教育背景、工作经历、技术技能和项目成就等事实。
                </li>
                <li>
                  <strong className="text-foreground">面试交互数据</strong>：模拟面试进行过程中的文本回答、音频输入（经本地语音识别转化为文字）、作答耗时及 AI 面试官生成的评估报告与评分记录。
                </li>
                <li>
                  <strong className="text-foreground">系统日志与性能数据</strong>：为了保证系统稳定与防止恶意刷量，系统会自动记录访问 IP 地址、浏览器类型与崩溃日志。
                </li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-bold text-foreground mb-3">3. 信息的使用目的</h2>
              <p className="text-muted-foreground mb-2">
                我们严格按照最小必要原则，仅将收集的信息用于以下明确目的：
              </p>
              <ul className="list-disc pl-5 space-y-1.5 text-muted-foreground">
                <li>基于你的真实简历提炼技术图谱，生成个性化的面试开场与针对性追问；</li>
                <li>运用六维能力模型（理解力、表达力、逻辑性、深度、真实性、反思力）对你的回答进行多维度评估打分；</li>
                <li>生成详细的复盘分析报告，提供逐题改进范例与学习建议；</li>
                <li>保障产品核心功能的正常运行、系统维护与安全防御。</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-bold text-foreground mb-3">4. 核心安全承诺与防泄露机制</h2>
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-foreground/90 space-y-2 my-3">
                <p className="font-semibold text-primary">
                  严正声明：用户隐私是 Seconda 的生存红线。
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  • <strong>零公开训练</strong>：我们与底层 AI 供应商（如 Anthropic 等）均签署企业级数据保护协议，你的任何简历事实、面试记录和评估细节<strong>绝不</strong>会被用于基础通用模型的二次预训练。<br />
                  • <strong>零商业倒卖</strong>：我们绝不会将你的个人求职意向、联系方式或简历卖给任何第三方猎头机构、雇主公司或数据经纪商。<br />
                  • <strong>严格多租户隔离</strong>：生产数据库采用基于用户 ID 的强行级安全隔离（RLS），任何其他用户均无法跨权限调取你的简历与报告。
                </p>
              </div>
            </section>

            <section>
              <h2 className="text-xl font-bold text-foreground mb-3">5. 你的权利：随时一键彻底删除</h2>
              <p className="text-muted-foreground">
                你对自己的个人信息拥有完全的控制权：
              </p>
              <ul className="list-disc pl-5 space-y-1.5 text-muted-foreground">
                <li>你可以随时在「工作台」中查阅、编辑或替换你的简历信息；</li>
                <li>当你点击「删除简历」或「删除面试记录」时，系统将在生产数据库及云端对象存储中执行<strong>不可逆的彻底物理抹除</strong>，绝不留存任何隐蔽备份；</li>
                <li>如需注销账户并彻底清空所有历史数据，可直接发送邮件至 support 进行快速注销。</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-bold text-foreground mb-3">6. Cookies 与本地存储</h2>
              <p className="text-muted-foreground">
                我们使用少量的必要 Cookie 和本地缓存来保持你的安全登录会话（Session）与语言偏好设置（中文 / 英文）。我们不使用任何侵入式的跨站跟踪类广告 Cookie。
              </p>
            </section>

            <section>
              <h2 className="text-xl font-bold text-foreground mb-3">7. 政策修订与联系方式</h2>
              <p className="text-muted-foreground">
                随着产品功能演进与相关法律法规的变化，我们可能会适时修订本政策。重大变更将在网站显著位置进行公示。如对本政策有任何疑问、意见或个人隐私权利请求，请随时联系我们的安全团队：
                <br />
                <span className="font-mono text-foreground font-medium">zyx19981379@gmail.com</span>
              </p>
            </section>
          </div>
        </div>
      </main>

      <MarketingFooter />
    </div>
  );
}
