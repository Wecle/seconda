import Link from "next/link";
import { BrandIcon } from "@/components/brand/brand-icon";

export function MarketingFooter() {
  return (
    <footer className="border-t border-border/80 bg-card/40 py-14">
      <div className="mx-auto max-w-6xl px-6">
        <div className="grid grid-cols-1 gap-10 md:grid-cols-4 pb-12 border-b border-border/50">
          {/* Brand Col */}
          <div className="space-y-4 md:col-span-1">
            <Link
              href="/"
              className="flex items-center gap-2.5 text-base font-bold text-foreground"
            >
              <BrandIcon size={26} />
              <span>Seconda</span>
            </Link>
            <p className="text-xs text-muted-foreground leading-relaxed">
              基于真实简历深度锚定、自适应多轮追问与六维能力评估模型的 AI 模拟面试系统。
            </p>
          </div>

          {/* Product Links */}
          <div className="space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground">
              核心特性
            </h4>
            <ul className="space-y-2 text-xs text-muted-foreground">
              <li>
                <Link
                  href="/#features"
                  className="transition-colors hover:text-foreground"
                >
                  多维感知功能矩阵
                </Link>
              </li>
              <li>
                <Link
                  href="/#dimensions"
                  className="transition-colors hover:text-foreground"
                >
                  六维评估模型
                </Link>
              </li>
              <li>
                <Link
                  href="/#journey"
                  className="transition-colors hover:text-foreground"
                >
                  4 步实战闭环
                </Link>
              </li>
              <li>
                <Link
                  href="/#faq"
                  className="transition-colors hover:text-foreground"
                >
                  常见问题解答
                </Link>
              </li>
            </ul>
          </div>

          {/* Resources / Blog */}
          <div className="space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground">
              求职指南与干货
            </h4>
            <ul className="space-y-2 text-xs text-muted-foreground">
              <li>
                <Link
                  href="/blog"
                  className="transition-colors hover:text-foreground font-medium text-foreground/80"
                >
                  全部面试指南与博客
                </Link>
              </li>
              <li>
                <Link
                  href="/blog/star-method-interview-guide"
                  className="transition-colors hover:text-foreground"
                >
                  STAR 法则实战进阶
                </Link>
              </li>
              <li>
                <Link
                  href="/blog/ai-mock-interview-strategies"
                  className="transition-colors hover:text-foreground"
                >
                  告别背八股：自适应深度追问
                </Link>
              </li>
              <li>
                <Link
                  href="/blog/technical-resume-optimization"
                  className="transition-colors hover:text-foreground"
                >
                  高通过率技术简历打造
                </Link>
              </li>
            </ul>
          </div>

          {/* Legal & Compliance */}
          <div className="space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground">
              合规与支持
            </h4>
            <ul className="space-y-2 text-xs text-muted-foreground">
              <li>
                <Link
                  href="/privacy"
                  className="transition-colors hover:text-foreground"
                >
                  隐私政策（数据安全承诺）
                </Link>
              </li>
              <li>
                <Link
                  href="/terms"
                  className="transition-colors hover:text-foreground"
                >
                  使用条款与服务协议
                </Link>
              </li>
              <li>
                <a
                  href="mailto:zyx19981379@gmail.com"
                  className="transition-colors hover:text-foreground"
                >
                  联系我们（技术与客服支持）
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-muted-foreground">
          <p>© 2026 Seconda. All rights reserved.</p>
          <p className="font-mono text-[11px]">
            Engineered with Impeccable & Taste Standards
          </p>
        </div>
      </div>
    </footer>
  );
}
