<div align="center">
  <img src="public/logo.png" alt="Seconda Logo" width="120" />
  <h1>Seconda</h1>
  <p><strong>基于简历深度对齐与多轮追问的下一代 AI 模拟面试系统</strong></p>
  <p>An AI-powered mock interview platform engineered for deep resume-grounded practice, adaptive follow-ups, and deterministic 6-dimension evaluation.</p>

  <p>
    <img src="https://img.shields.io/badge/Next.js-16.1-black?logo=next.js" alt="Next.js" />
    <img src="https://img.shields.io/badge/React-19-blue?logo=react" alt="React" />
    <img src="https://img.shields.io/badge/TypeScript-5.x-blue?logo=typescript" alt="TypeScript" />
    <img src="https://img.shields.io/badge/TailwindCSS-v4-38bdf8?logo=tailwindcss" alt="TailwindCSS" />
    <img src="https://img.shields.io/badge/Drizzle_ORM-PostgreSQL-green?logo=postgresql" alt="Database" />
  </p>
</div>

---

## 概述 / Overview

**Seconda** 致力于打破传统模拟面试中依赖固定题库与泛化对话的痛点。系统深度解析候选人简历（支持 PDF 与结构化经历输入），精准提取真实项目细节、架构选型与量化成果，结合自主面试 Agent 发起有深度、有针对性的多轮递进追问，并通过确定性的 6 维度数学模型对回答进行严谨量化评估。

> [!NOTE]
> Seconda 坚持**事实驱动（Fact-Grounded）**与**确定性计算（Deterministic Scoring）**原则：所有面试提问紧扣候选人真实经历，所有聚合评分均由后端系统确定性计算，杜绝大模型直接输出汇总分带来的幻觉与漂移。

---

## 核心特性 / Features

### 📄 简历深度解析与结构化生成
- **PDF 智能解析**：结合 WebAssembly 原生能力与大模型事实提取，提取候选人技能树、项目难点、技术架构与量化业绩。
- **结构化事实生成**：支持直接输入个人事实经历，由 AI 辅助生成结构严谨、重点突出的标准简历。

### 🎯 自适应 Agent 深度面试
- **简历事实锚定**：面试问题 100% 紧扣候选人真实经历展开，避免空泛模板套话。
- **实时思考链路与多轮追问**：具备透明的思考链（Thinking Process），针对候选人回答中模糊不清、缺乏权衡或未提及异常治理的环节发起递进式追问。
- **丰富的人设与偏好定制**：
  - **面试官人设**：友好型（循序渐进）、标准型（专业客观）、压力型（极限深挖与边界质疑）。
  - **面试偏好**：项目深挖（Project Deep Dive）、技术基础（Foundations）、行为经历（STAR Behavioral）。
  - **双语与职级支持**：支持中英文双语以及初级、中级、高级、Staff/Principal 等不同职级要求。

### 📊 6 维度确定性评分体系
- 对每道题目的回答从 **6 个核心维度**（各 0–10 分）进行专业评估。
- 后端确定性计算单题综合分（0–10.0 分）与面试整体得分（0–100 分），杜绝人为与模型统计偏差。

### 💡 综合评估报告与教练模式（Coach Mode）
- **能力雷达图**：直观呈现 6 维度得分分布与优劣势定位。
- **逐题深度复盘（Deep Dive）**：提供详细的得失分剖析、改进建议以及基于 STAR 框架的标准示范回答与避坑指引。

### ⚡ 双梯队分层模型架构与遥测治理
- **Fast Tier**：负责低延迟的实时对话、开场提问与上下文压缩。
- **Quality Tier**：负责高精度的简历结构化解析、6 维度评分与终局综合报告生成。
- **韧性与预算控制**：内置模型降级容灾机制（Fallback）、严格的 Token 预算管理以及完整的 AI 遥测与成本跟踪。

---

## 6 维度评分模型 / Scoring Model

Seconda 从以下 6 个核心维度对候选人的每一次回答进行 0–10 的整数量化评分：

| 维度 (Dimension) | 中文名称 | 评估标准 (Evaluation Criteria) |
|---|---|---|
| **Understanding** | 理解力 | 是否准确识别题目的核心意图、技术约束与隐含业务边界？ |
| **Expression** | 表达力 | 语言组织是否严谨精炼、技术术语是否准确？是否存在无效套话？ |
| **Logic** | 逻辑性 | 推理是否自洽，是否运用 STAR 原则或自顶向下的结构化思维？ |
| **Depth** | 深度 | 是否深入到底层运行机制、架构权衡、边界异常与性能瓶颈？ |
| **Authenticity** | 真实性 | 是否具备真实工程实战细节、数据指标支撑与实际得失反思？ |
| **Reflection** | 反思力 | 是否展现出技术自省能力、复盘总结思维与持续演进认知？ |

### 评分计算公式

$$ \text{单题综合得分} = \frac{1}{6} \sum_{i=1}^{6} \text{维度得分}_i \quad (\text{保留 1 位小数，范围 } 0.0 - 10.0) $$

$$ \text{整场面试综合得分} = \text{round}\left(\text{average}(\text{单题综合得分}) \times 10\right) \quad (\text{整数，范围 } 0 - 100) $$

> [!TIP]
> 所有加权计算与均值聚合均在后端通过确定性算法完成，AI 模型仅负责对单个维度的质量判定与文字诊断。

---

## 技术栈 / Tech Stack

| 领域 | 技术方案 | 说明 |
|---|---|---|
| **核心框架** | Next.js 16 (App Router), React 19 | 全栈 React 服务端组件与流式渲染 |
| **开发语言** | TypeScript 5.x (Strict) | 严苛的全流程类型安全保障 |
| **界面与样式** | TailwindCSS v4, shadcn/ui, Radix UI, Lucide Icons | 现代化设计系统与高可访问性组件 |
| **AI 基础设施** | Vercel AI SDK (`ai`), OpenAI / Anthropic / DeepSeek / Zhipu | 统一模型调用与结构化对象输出 |
| **数据库 & ORM** | PostgreSQL, Drizzle ORM, `postgres` driver | 高性能关系型存储与类型安全数据映射 |
| **身份认证** | Auth.js (NextAuth v5 beta) | 支持 GitHub、Google OAuth 等鉴权机制 |
| **文档与媒体** | `@vercel/blob`, `pdf-oxide-wasm`, `pdfjs-dist`, `react-pdf` | 原生 WASM 高性能 PDF 解析与对象存储 |

---

## 快速开始 / Getting Started

### 前置要求
- **Node.js**: >= 20.0.0
- **包管理器**: `pnpm` (>= 9.0.0)
- **数据库**: PostgreSQL 实例 (本地或云端)
- **AI 凭证**: 兼容 Fast Tier 和 Quality Tier 的大模型 API Key

### 安装与运行

1. **克隆仓库并安装依赖**
   ```bash
   git clone https://github.com/your-org/seconda.git
   cd seconda
   pnpm install
   ```

2. **配置环境变量**
   ```bash
   cp .env.example .env
   ```
   根据实际情况在 `.env` 中填写数据库连接串与 AI 模型 API 密钥。

3. **执行数据库迁移**
   ```bash
   pnpm db:migrate
   ```

4. **启动本地开发服务器**
   ```bash
   pnpm dev
   ```
   在浏览器中访问 [http://localhost:3000](http://localhost:3000)。

---

## 环境变量配置 / Environment Variables

| 变量名 | 必填 | 说明 |
|---|---|---|
| `DATABASE_URL` | 是 | PostgreSQL 数据库连接串 |
| `FAST_MODEL_API_KEY` | 是 | Fast Tier 模型提供商 API 密钥 |
| `QUALITY_MODEL_API_KEY` | 是 | Quality Tier 模型提供商 API 密钥 |
| `AI_MODEL_FAST` | 是 | Fast Tier 主模型（如 `deepseek/deepseek-v4-flash`） |
| `AI_MODEL_QUALITY` | 是 | Quality Tier 主模型（如 `zhipu/glm-5.1`） |
| `AI_APPROVED_MODELS` | 是 | 允许使用的模型白名单列表（逗号分隔） |
| `AUTH_SECRET` | 是 | Auth.js 会话签名加密密钥（可通过 `openssl rand -base64 32` 生成） |
| `AI_MODEL_FAST_FALLBACK` | 否 | Fast Tier 备用降级模型 |
| `AI_MODEL_QUALITY_FALLBACK` | 否 | Quality Tier 备用降级模型 |
| `AI_BUDGET_MODE` | 否 | AI 预算防护模式（`observe` / `enforce`） |
| `AI_TASK_TOKEN_LIMIT` | 否 | 单任务最大 Token 上限保护（默认 500,000） |
| `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` | 否 | GitHub OAuth 登录凭证 |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | 否 | Google OAuth 登录凭证 |
| `BLOB_READ_WRITE_TOKEN` | 否 | Vercel Blob 存储令牌（用于简历原件托管） |

> [!IMPORTANT]
> 主模型与备用降级模型在同一 Tier 下建议保持提供商前缀一致，以保证在 API 出现波动时能无缝切流降级。

---

## 常用脚本 / Available Scripts

```bash
# 启动本地开发服务
pnpm dev

# 构建生产版本
pnpm build

# 启动生产服务
pnpm start

# 代码规范检查
pnpm lint

# 运行单元与集成测试套件
pnpm test

# 运行在线 AI 契约连通性测试
pnpm test:ai:contract

# 执行数据库表结构迁移
pnpm db:migrate

# 执行本地 .env 数据库迁移
pnpm db:migrate:local
```

---

## 项目目录结构 / Project Structure

```text
seconda/
├── app/                  # Next.js App Router 路由与页面
│   ├── (app)/            # 业务页面路由 (dashboard, interviews, agent)
│   ├── api/              # API Route Handlers (Auth, Interviews, Resumes)
│   ├── globals.css       # TailwindCSS 全局样式配置
│   └── page.tsx          # 平台 Landing Page 首页
├── components/           # UI 组件库
│   ├── agent/            # 面试 Agent 工作区与交互组件
│   ├── dashboard/        # 面试看板与简历管理组件
│   ├── interview/        # 模拟面试房间、设置与复盘报告视图
│   ├── landing/          # 首页 Bento Grid、动效与特性展示
│   ├── resume/           # 简历上传、预览与编辑组件
│   └── ui/               # 基于 shadcn/ui 的基础 UI 组件
├── lib/                  # 核心业务逻辑与基础设施
│   ├── agent/            # Agent 状态机、上下文预算与运行时策略
│   ├── ai/               # AI 提供商适配、分层模型策略与遥测监控
│   ├── db/               # PostgreSQL 数据库连接、Drizzle Schema 与迁移
│   ├── i18n/             # 国际化语言包与上下文
│   ├── interview/        # 面试编排、自适应循环与 6 维度评分引擎
│   └── resume/           # PDF 解析、文本规范化与简历生成逻辑
├── public/               # 静态资源 (logo.png, llms.txt, 文档规范)
└── docs/                 # 架构方案与需求设计文档
```
