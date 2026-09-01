# Cloudflare 部署指南

本分支（`cloudflare-deploy`）专为基于 Cloudflare Workers / OpenNext 部署 Seconda 面试系统进行配置与优化。

---

## 架构与技术栈

- **适配器**: `@opennextjs/cloudflare` (官方推荐 Next.js App Router 适配方案)
- **CLI / 运行时**: `wrangler` + Cloudflare Workers (`nodejs_compat`)
- **配置**: [open-next.config.ts](file:///open-next.config.ts), [wrangler.jsonc](file:///wrangler.jsonc)

---

## 快速开始

### 1. 登录 Cloudflare
```bash
npx wrangler login
```

### 2. 本地构建与预览
```bash
pnpm build:worker
pnpm preview:worker
```

### 3. 一键部署到 Cloudflare Workers
```bash
pnpm deploy:worker
```

---

## 环境变量与机密配置 (Cloudflare Secrets)

由于 Cloudflare Workers 运行在边缘环境，请在 Cloudflare Dashboard 或通过 `wrangler secret put` 设置以下环境变量：

### 必填环境变量
```bash
# 数据库连接 (推荐使用 Supabase / Neon / Cloudflare Hyperdrive 代理连接)
npx wrangler secret put DATABASE_URL

# Auth.js 密钥
npx wrangler secret put AUTH_SECRET

# AI 模型 Key
npx wrangler secret put FAST_MODEL_API_KEY
npx wrangler secret put QUALITY_MODEL_API_KEY

# 对象存储 (Vercel Blob 或 R2)
npx wrangler secret put BLOB_READ_WRITE_TOKEN
```

### 可选 / OAuth 环境变量
```bash
npx wrangler secret put AUTH_GITHUB_ID
npx wrangler secret put AUTH_GITHUB_SECRET
npx wrangler secret put AUTH_GOOGLE_ID
npx wrangler secret put AUTH_GOOGLE_SECRET
```

---

## 数据库说明

Cloudflare Workers 通过 Node.js 兼容层 (`nodejs_compat`) 与标准 PostgreSQL (TCP / WebSocket) 建立连接。推荐搭配以下方式之一：
1. **Cloudflare Hyperdrive**: 加速全球边缘数据库查询与连接池复用。
2. **Serverless Postgres (如 Neon / Supabase)**: 直接支持 Serverless 与边缘连接。

---

## 常用脚本命令

| 命令 | 说明 |
|---|---|
| `pnpm build:worker` | 使用 `@opennextjs/cloudflare` 构建生产包 |
| `pnpm preview:worker` | 本地启动 Cloudflare Workerd 模拟运行环境 |
| `pnpm deploy:worker` | 构建并部署到 Cloudflare Workers |
| `pnpm cf-typegen` | 生成 Cloudflare 环境绑定 TypeScript 类型定义 |
