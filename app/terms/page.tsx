import type { Metadata } from "next";
import { MarketingNav } from "@/components/marketing/marketing-nav";
import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { FileText, CheckCircle2 } from "lucide-react";

export const metadata: Metadata = {
  title: "使用条款与服务协议",
  description:
    "欢迎阅读 Seconda 用户使用协议与服务条款。了解使用 Seconda AI 模拟面试系统的权利、义务与服务规范。",
  alternates: {
    canonical: "/terms",
  },
};

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col selection:bg-primary/20 selection:text-primary">
      <MarketingNav />

      <main className="flex-1 py-16 sm:py-24">
        <div className="mx-auto max-w-4xl px-6">
          {/* Header */}
          <div className="mb-12 border-b border-border/70 pb-8">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3.5 py-1 text-xs font-semibold text-primary mb-4">
              <FileText className="size-3.5" />
              <span>用户服务协议</span>
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl text-foreground">
              Seconda 使用条款与服务协议
            </h1>
            <p className="mt-3 text-sm text-muted-foreground">
              最近更新日期：2026 年 9 月 12 日 · 生效日期：2026 年 9 月 12 日
            </p>
          </div>

          <div className="prose prose-slate dark:prose-invert max-w-none text-sm leading-relaxed space-y-8">
            <section>
              <h2 className="text-xl font-bold text-foreground mb-3">1. 协议的确认与接纳</h2>
              <p className="text-muted-foreground">
                欢迎访问并使用由 Seconda 团队（以下简称“Seconda”或“我们”）提供的 AI 模拟面试与职场技能评估服务。在注册、登录或使用 Seconda 服务前，请务必审慎阅读并充分理解本《使用条款与服务协议》（以下简称“本协议”）。当你点击注册、登录或实际使用本服务时，即视为你已阅读、理解并同意接受本协议的全部约束。
              </p>
            </section>

            <section>
              <h2 className="text-xl font-bold text-foreground mb-3">2. 账号注册与安全</h2>
              <ul className="list-disc pl-5 space-y-1.5 text-muted-foreground">
                <li>你应保证注册或登录时提供的身份信息真实、合法、有效。</li>
                <li>你应当妥善保管自己的登录凭证（邮箱验证码、第三方授权密码等），因你自身保管不善导致的任何账号被盗或数据损失，需由你自行承担相应责任。</li>
                <li>任何通过你账号发起的操作（包括但不限于上传简历、发起模拟面试、删除数据等）均视为你本人的真实意思表示。</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-bold text-foreground mb-3">3. 服务内容与合理使用规范</h2>
              <p className="text-muted-foreground mb-2">
                Seconda 为用户提供基于大语言模型的自适应模拟面试对练、六维能力评估报告及求职备战指南。你在使用本服务时必须遵守国家法律法规及公序良俗，不得利用本服务实施以下行为：
              </p>
              <ul className="list-disc pl-5 space-y-1.5 text-muted-foreground">
                <li>对 Seconda 平台发起高频恶意攻击、DDoS、漏洞探测或未经授权的数据抓取；</li>
                <li>对本平台的底层算法、系统提示词（Prompts）或专有评测模型进行逆向工程、反编译或盗用；</li>
                <li>上传含有病毒、恶意木马或侵犯第三方隐私、知识产权的非法文件；</li>
                <li>利用模拟面试对话管道生成或传播任何危害国家安全、涉黄、涉暴、虚假欺诈或侮辱诽谤的违规内容。</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-bold text-foreground mb-3">4. 知识产权与用户数据归属</h2>
              <div className="space-y-2 text-muted-foreground">
                <p>
                  <strong className="text-foreground">（1）用户个人资产</strong>：你拥有自己上传的原始简历内容、个人面试作答内容的完全知识产权。我们仅在为你提供本协议所约定的技术服务时使用该数据，且严格遵守《隐私政策》。
                </p>
                <p>
                  <strong className="text-foreground">（2）平台知识产权</strong>：Seconda 的网站架构、UI 界面设计、代码、算法模型逻辑、六维评估体系及品牌标识（商标、Logo）等均受法律保护，知识产权归 Seconda 及其权利人所有。未经我们书面许可，任何人不得擅自使用、复制或镜像。
                </p>
              </div>
            </section>

            <section>
              <h2 className="text-xl font-bold text-foreground mb-3">5. AI 技术特性与免责声明</h2>
              <div className="rounded-xl border border-border/80 bg-muted/40 p-4 text-xs text-muted-foreground space-y-2">
                <div className="flex items-center gap-1.5 font-semibold text-foreground">
                  <CheckCircle2 className="size-4 text-primary" />
                  <span>重要提示：AI 模拟评测性质</span>
                </div>
                <p className="leading-relaxed">
                  • Seconda 基于领先的人工智能大语言模型构建，AI 面试官给出的追问、评分及建议旨在帮助求职者发现技能盲区、规范表达逻辑；<br />
                  • <strong>本平台评估结果仅供个人自我提升参考，不构成对任何特定企业真实面试结果、录用薪酬或职业准入的任何形式的保证或担保</strong>；<br />
                  • 尽管我们持续优化模型的严谨性与事实锚定能力，大语言模型仍可能在极少数情况下产生非预期偏见或偶发幻觉，用户在采纳专业建议时应结合行业实际情况审慎判断。
                </p>
              </div>
            </section>

            <section>
              <h2 className="text-xl font-bold text-foreground mb-3">6. 服务的变更、中断与终止</h2>
              <p className="text-muted-foreground">
                我们始终致力于提供不间断的高质量服务，但鉴于网络服务的特殊性，因不可抗力、网络拥堵、第三方云服务商故障或例行系统维护导致的临时服务中断，我们会在合理范围内尽力减少影响，但免于承担由此导致的间接损失。
              </p>
            </section>

            <section>
              <h2 className="text-xl font-bold text-foreground mb-3">7. 协议更新与争议解决</h2>
              <p className="text-muted-foreground">
                本协议的订立、执行、解释及争议解决均适用中华人民共和国法律。如双方就本协议内容或其执行发生任何争议，双方应尽量友好协商解决；协商不成时，任何一方均可向平台所在地有管辖权的人民法院提起诉讼。
              </p>
            </section>
          </div>
        </div>
      </main>

      <MarketingFooter />
    </div>
  );
}
