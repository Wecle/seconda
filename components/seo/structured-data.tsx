import type { Locale } from "@/lib/i18n";

export function StructuredData({ locale = "zh" }: { locale?: Locale }) {
  const siteUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const isEn = locale === "en";
  const canonicalUrl = isEn ? `${siteUrl}/en` : siteUrl;

  const organizationSchema = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Seconda",
    url: canonicalUrl,
    logo: `${siteUrl}/logo.png`,
    email: "zyx19981379@gmail.com",
    description: isEn
      ? "AI-Powered High-Fidelity Mock Interview Platform grounded in resume facts and a 6-dimension evaluation matrix."
      : "AI 驱动的高拟真模拟面试系统，基于简历事实锚定与六维能力模型。",
    sameAs: [],
  };

  const softwareApplicationSchema = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "Seconda AI Mock Interview",
    applicationCategory: "EducationalApplication",
    operatingSystem: "Web Browser",
    url: canonicalUrl,
    description: isEn
      ? "AI-powered mock interview system featuring resume fact grounding, adaptive multi-turn follow-ups, and a 6-dimension evaluation rubric (Understanding, Expression, Logic, Depth, Authenticity, Reflection)."
      : "基于简历事实深度锚定、自适应多轮追问与六维能力模型（理解力、表达力、逻辑性、深度、真实性、反思力）的 AI 模拟面试系统。",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
      category: "FreeTier",
    },
    featureList: isEn
      ? [
          "PDF resume parsing and fact graph extraction",
          "Adaptive Agent follow-ups with transparent reasoning stream",
          "6-dimension quantitative evaluation matrix (0–100 scale)",
          "Coach Mode deep-dive review with STAR framework breakdown",
          "Multiple interviewer styles (Friendly, Standard, High-Pressure)",
        ]
      : [
          "PDF 简历智能解析与事实图谱提取",
          "自适应 Agent 连续追问与思考链路展示",
          "6 维量化综合评估矩阵 (0-100分)",
          "教练模式 (Coach Mode) 逐题深度复盘与 STAR 范式解析",
          "多元面试官风格 (友好型、标准型、高压型)",
        ],
  };

  const howToSchema = isEn
    ? {
        "@context": "https://schema.org",
        "@type": "HowTo",
        name: "How to Practice High-Fidelity Mock Interviews with Seconda",
        description:
          "A 4-step closed-loop interview mastery flow from resume upload to 6-dimension retrospective review.",
        totalTime: "PT20M",
        step: [
          {
            "@type": "HowToStep",
            position: 1,
            name: "Smart Resume Parsing",
            text: "Upload your PDF resume or provide career facts. AI extracts your tech stack and project highlights instantly.",
          },
          {
            "@type": "HowToStep",
            position: 2,
            name: "Tailored Configuration",
            text: "Customize target job level, technical focus (deep dive, fundamentals, behavioral), language, and interviewer persona.",
          },
          {
            "@type": "HowToStep",
            position: 3,
            name: "Agent Live Practice",
            text: "Engage in an immersive session with adaptive multi-turn probing targeting architectural blind spots.",
          },
          {
            "@type": "HowToStep",
            position: 4,
            name: "In-Depth Coaching & Report",
            text: "Review the 6-dimension radar rubric and per-question scores, then enter Coach Mode for STAR-style model answers.",
          },
        ],
      }
    : {
        "@context": "https://schema.org",
        "@type": "HowTo",
        name: "如何使用 Seconda 进行高拟真 AI 模拟面试训练",
        description: "4 步闭环沉浸式训练流程，从简历输入到六维深度复盘。",
        totalTime: "PT20M",
        step: [
          {
            "@type": "HowToStep",
            position: 1,
            name: "智能解析简历",
            text: "上传 PDF 简历或输入真实履历事实，AI 秒级提炼技术栈与项目亮点，构建知识图谱。",
          },
          {
            "@type": "HowToStep",
            position: 2,
            name: "个性化配置",
            text: "定制目标职级、技术偏好（项目深挖/基础夯实/行为面试）、多语言与面试官风格（友好/标准/高压）。",
          },
          {
            "@type": "HowToStep",
            position: 3,
            name: "Agent 实战模拟",
            text: "沉浸式对练，支持富文本/语音输入，自适应多轮追问直击技术盲区与思维漏洞。",
          },
          {
            "@type": "HowToStep",
            position: 4,
            name: "深度复盘报告",
            text: "查看六维雷达图与逐题评分，开启教练模式学习标准答案结构与常见误区。",
          },
        ],
      };

  const faqSchema = isEn
    ? {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: [
          {
            "@type": "Question",
            name: "How does Seconda differ from generic question banks or chatbot interviews?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "Traditional banks ask decoupled trivia, while generic AI lacks follow-up depth. Seconda grounds 100% in your actual resume projects and design decisions. The adaptive agent spots gaps in real-time, presses deeper across multiple turns, and computes deterministic scores on a 6-dimension rubric.",
            },
          },
          {
            "@type": "Question",
            name: "How does the 6-dimension scoring model calculate results?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "Each answer is scored 0–10 on Understanding, Expression, Logic, Depth, Authenticity, and Reflection. Per-question score is the equal-weighted average (1/6 each, rounded to 1 decimal place). The overall interview score is deterministically calculated as average(per-question overall) × 10 (0–100 integer).",
            },
          },
          {
            "@type": "Question",
            name: "How does the AI interviewer follow up adaptively?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "With an active Reasoning Stream, the AI interviewer continuously reconciles candidate statements against resume claims. When a response is superficial, lacks metrics, or misses edge cases, it initiates focused follow-up questions to test foundational depth.",
            },
          },
          {
            "@type": "Question",
            name: "What is Coach Mode?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "After finishing an interview, Coach Mode allows you to deep-dive into any specific question to understand examiner intent, examine logic flaws, and review STAR-framework benchmark structures.",
            },
          },
          {
            "@type": "Question",
            name: "Is my resume and interview data private?",
            acceptedAnswer: {
              "@type": "Answer",
              text: "Yes. All resumes and session transcripts are stored securely with strict user-level access controls and are never shared with third parties or used for public foundation model training.",
            },
          },
        ],
      }
    : {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: [
          {
            "@type": "Question",
            name: "Seconda 与传统刷题题库或通用 AI 聊天有什么本质区别？",
            acceptedAnswer: {
              "@type": "Answer",
              text: "传统题库脱离真实经历，通用 AI 缺乏系统化追问深度。Seconda 100% 锚定你的真实简历项目与技术决策，由自适应 Agent 主动捕捉回答破绽并发起多轮深度追问，最后通过六维量化模型生成确定性评估报告。",
            },
          },
          {
            "@type": "Question",
            name: "六维评分模型是如何计算分数的？",
            acceptedAnswer: {
              "@type": "Answer",
              text: "模型从理解力、表达力、逻辑性、深度、真实性、反思力 6 个维度进行打分（每维 0–10 分整数）。单题总分为 6 维等权平均（占 1/6，保留 1 位小数），整场总分为单题得分均值乘以 10（0–100 分整数），由后端确定性算法计算。",
            },
          },
          {
            "@type": "Question",
            name: "AI 面试官如何展开自适应追问？",
            acceptedAnswer: {
              "@type": "Answer",
              text: "AI 面试官具备自主思考链路（Reasoning Stream），会实时比对简历事实与回答细节。当检测到回答过于表面、缺乏量化指标、存在架构破绽或未处理异常边界时，会立即发起针对性追问，检验底层技术功底。",
            },
          },
          {
            "@type": "Question",
            name: "什么是教练模式（Coach Mode）？",
            acceptedAnswer: {
              "@type": "Answer",
              text: "面试结束后，你可以针对任意一道题目进入教练模式。系统将剖析考点意图，指出答题中的逻辑漏洞，提供基于 STAR 法则的高分范式结构与可落地的表达优化建议。",
            },
          },
          {
            "@type": "Question",
            name: "我的简历数据和面试记录是否安全？",
            acceptedAnswer: {
              "@type": "Answer",
              text: "Seconda 严格保障用户隐私与数据安全。所有简历与面试会话均采用隔离存储与端到端权限保护，绝不泄露给任何第三方或用于未经授权的模型公开训练。",
            },
          },
        ],
      };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(softwareApplicationSchema),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(howToSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />
    </>
  );
}
