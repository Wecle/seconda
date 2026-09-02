# Cloudflare 部署指南

本分支（`cloudflare-deploy`）专为基于 Cloudflare Workers / OpenNext 部署 Seconda 面试系统进行配置与优化。

---

## 架构与技术栈

- **适配器**: `@opennextjs/cloudflare` (官方推荐 Next.js App Router 适配方案)
- **CLI / 运行时**: `wrangler` + Cloudflare Workers (`nodejs_compat`)
- **配置**: [open-next.config.ts](file:///open-next.config.ts), [wrangler.jsonc](file:///wrangler.jsonc)

---

## 环境变量隔离机制（与 main / Vercel 完全独立）

为了避免 Cloudflare 环境使用到 `main` 分支本地的 `.env.production.local`，本项目实现了三层环境隔离：

### 1. 本地构建期隔离 (`.env.cloudflare` + 环境隔离包装器)
- 复制模版：`cp .env.cloudflare.example .env.cloudflare`
- 所有构建命令（`pnpm build` / `build:worker` / `preview:worker` / `deploy:worker`）都会经过 `scripts/cf-with-env-isolation.mjs`：在整个 OpenNext 构建期间临时隐藏 `.env` / `.env.production.local` 等 Vercel 本地文件，防止 OpenNext 把它们编译进 worker bundle（`next-env.mjs` 快照会嵌入文件全部内容，含密钥），构建结束后自动恢复。
- `.env.cloudflare` 的值只注入构建进程（驱动 `next build`），不会进入 worker 产物；线上运行时完全依赖 Cloudflare bindings/secrets。
- 不要绕过包装器直接执行 `opennextjs-cloudflare build`（`build-cloudflare.mjs` 会打印警告）。

### 2. 本地 Worker 模拟运行隔离 (`.dev.vars`)
- 当执行 `pnpm preview:worker`（即 `wrangler dev`）时，Wrangler 会自动加载本地 `.dev.vars` 文件中的环境变量注入到 Worker 运行时。

### 3. 线上生产运行时隔离 (Cloudflare Secrets)
- 线上运行时**完全独立**于本地任何文件，直接从 Cloudflare Workers 注入。
- 可通过 Cloudflare Dashboard 或 CLI 设置：

```bash
# 必填项 (基础与 AI 密钥)
npx wrangler secret put DATABASE_URL
npx wrangler secret put AUTH_SECRET
npx wrangler secret put FAST_MODEL_API_KEY
npx wrangler secret put QUALITY_MODEL_API_KEY

# 必填项 (AI 模型策略与 Agent 配置)
npx wrangler secret put AI_MODEL_FAST
npx wrangler secret put AI_MODEL_FAST_FALLBACK
npx wrangler secret put AI_MODEL_QUALITY
npx wrangler secret put AI_MODEL_QUALITY_FALLBACK
npx wrangler secret put AI_APPROVED_MODELS
npx wrangler secret put AGENT_MODEL_CONTEXT_WINDOWS_JSON
npx wrangler secret put AGENT_MODEL_CONTEXT_BUDGETS_JSON
npx wrangler secret put INTERVIEW_AGENT_V2_ENABLED
npx wrangler secret put INTERVIEW_AGENT_LEASE_MS
npx wrangler secret put INTERVIEW_AGENT_LEASE_RENEW_MS
npx wrangler secret put INTERVIEW_AGENT_HEARTBEAT_MS
npx wrangler secret put INTERVIEW_AGENT_PROVIDER_IDLE_MS
npx wrangler secret put INTERVIEW_AGENT_CONTEXT_WINDOW
npx wrangler secret put INTERVIEW_AGENT_OUTPUT_RESERVE

# R2 私有对象存储：通过 wrangler.jsonc 的 r2_buckets 绑定（binding 名为 R2），
# 不需要 S3 API 密钥。桶名写在 wrangler.jsonc 中，代码经 getCloudflareContext().env.R2 访问。

# 可选项（OAuth）
npx wrangler secret put AUTH_GITHUB_ID
npx wrangler secret put AUTH_GITHUB_SECRET
npx wrangler secret put AUTH_GOOGLE_ID
npx wrangler secret put AUTH_GOOGLE_SECRET
```

---

## 快速开始

### 1. 登录 Cloudflare
```bash
npx wrangler login
```

### 2. 配置专属环境变量
```bash
cp .env.cloudflare.example .env.cloudflare
# 编辑 .env.cloudflare 填入对应配置
```

### 3. 本地构建与预览
```bash
pnpm build:worker
pnpm preview:worker
```

### 4. 一键部署到 Cloudflare Workers
```bash
pnpm deploy:worker
```

---

## 常用脚本命令

| 命令 | 说明 |
|---|---|
| `pnpm build` / `pnpm build:worker` | 使用 OpenNext 构建适配 Cloudflare 的 Worker 包（经环境隔离包装器，优先使用 `.env.cloudflare`） |
| `pnpm build:next` | 仅执行 Next.js 原生构建（跳过 OpenNext 打包，同样经过环境隔离包装器） |
| `pnpm preview:worker` | 本地启动 Cloudflare Workerd 模拟运行环境 |
| `pnpm deploy:worker` | 构建并部署到 Cloudflare Workers |
| `pnpm cf-typegen` | 生成 Cloudflare 环境绑定 TypeScript 类型定义（`env.d.ts` 仅本地参考用：其 workerd 全局类型与 DOM lib 冲突，已被 `.gitignore` / `tsconfig.json` 排除，不参与构建） |

### 数据库与存储绑定

- **数据库**：`wrangler.jsonc` 的 `hyperdrive` 绑定（`HYPERDRIVE`），代码经 `getCloudflareContext().env.HYPERDRIVE.connectionString` 连接（对象绑定不会出现在 `process.env`）。
- **对象存储**：`wrangler.jsonc` 的 `r2_buckets` 绑定（`R2`），走 Cloudflare 原生 binding API（`@aws-sdk/client-s3` 在 Workers 上因 `fs.readFile` 崩溃，已移除）。
- Workers 内数据库连接按请求缓存（`WeakMap<请求上下文>`）：Workers 的 outbound socket 生命周期绑定请求，跨请求复用连接会间歇性挂死。

---

## 简历上传与异步解析架构

- **设计模式**：客户端浏览器（`pdfjs-dist`）提取 PDF 文本 → `POST /api/resumes/upload` 仅落盘（R2 文件 + DB 记录，状态设为 `parsing`）并秒级响应 → 前端后台异步触发 `POST /api/resumes/{id}/versions/{versionId}/reparse` 执行 AI 解析。
- **架构约束**：Cloudflare Workers 免费版单请求 CPU 预算约为 10ms。文本密集型 PDF 服务端提取会导致 CPU 超限并抛出 error 1102 (503)。因此，禁止将 CPU 密集型操作（如 PDF 解析与全文处理）放回服务端同步请求路径；AI 调用为 IO-bound，拆分后在独立 reparse 请求中执行可稳定运行。
- **断点续跑**：前端 Dashboard 加载时会自动扫描并续跑处于 `parsing` 状态的历史版本，同时具备会话内单次尝试去重保护。
