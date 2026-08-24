# Seconda

Seconda 是一个基于 Next.js 16、React 19 和 PostgreSQL 的 AI 模拟面试产品。

当前分支正在重新实现面试 Agent。旧面试运行时、接口、页面、报告、复盘和历史数据结构均已移除；简历管理、PDF 解析、AI 简历生成和账号能力继续可用。用户点击“使用此版本开始面试”时，界面会提示系统正在维护中。

## 本地开发

```bash
pnpm install
cp .env.example .env
pnpm db:migrate
pnpm dev
```

打开 [http://localhost:3000](http://localhost:3000)。

## 常用命令

```bash
pnpm dev
pnpm build
pnpm lint
pnpm test
pnpm exec tsc --noEmit
pnpm db:migrate
```

## 环境变量

必须配置：

- `DATABASE_URL`
- `FAST_MODEL_API_KEY`
- `QUALITY_MODEL_API_KEY`
- `AI_MODEL_FAST`
- `AI_MODEL_QUALITY`
- `AI_APPROVED_MODELS`
- `AUTH_SECRET`

可选配置见 `.env.example`。

## 数据库迁移说明

本分支不兼容旧面试数据。执行 `pnpm db:migrate` 会删除所有旧面试、Agent Run、消息、题目、评分、报告、分享和 Deep Dive 表，同时保留账号、简历版本与通用 AI 遥测表。
