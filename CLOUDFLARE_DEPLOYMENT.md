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

### 1. 本地构建期隔离 (`.env.cloudflare`)
- 复制模版：`cp .env.cloudflare.example .env.cloudflare`
- 在执行 `pnpm build:worker` 或 `pnpm deploy:worker` 时，构建系统会自动优先读取 `.env.cloudflare`（若存在），不再读取主分支的 `.env.production.local`。

### 2. 本地 Worker 模拟运行隔离 (`.dev.vars`)
- 当执行 `pnpm preview:worker`（即 `wrangler dev`）时，Wrangler 会自动加载本地 `.dev.vars` 文件中的环境变量注入到 Worker 运行时。

### 3. 线上生产运行时隔离 (Cloudflare Secrets)
- 线上运行时**完全独立**于本地任何文件，直接从 Cloudflare Workers 注入。
- 可通过 Cloudflare Dashboard 或 CLI 设置：

```bash
# 必填项
npx wrangler secret put DATABASE_URL
npx wrangler secret put AUTH_SECRET
npx wrangler secret put FAST_MODEL_API_KEY
npx wrangler secret put QUALITY_MODEL_API_KEY
npx wrangler secret put BLOB_READ_WRITE_TOKEN

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
| `pnpm build:worker` | 使用 OpenNext 构建适配 Cloudflare 的 Worker 包（优先使用 `.env.cloudflare`） |
| `pnpm preview:worker` | 本地启动 Cloudflare Workerd 模拟运行环境 |
| `pnpm deploy:worker` | 构建并部署到 Cloudflare Workers |
| `pnpm cf-typegen` | 生成 Cloudflare 环境绑定 TypeScript 类型定义 |
