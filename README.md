<p align="center">
  <img src="./public/logo.png" alt="Seconda Logo" width="96" height="96" />
</p>

<h1 align="center">Seconda</h1>

<p align="center">
  AI Mock Interview System · 基于简历的智能模拟面试训练平台
</p>

<p align="center">
  <img alt="Next.js" src="https://img.shields.io/badge/Next.js-16-black" />
  <img alt="React" src="https://img.shields.io/badge/React-19-149ECA" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-Strict-3178C6" />
  <img alt="TailwindCSS" src="https://img.shields.io/badge/TailwindCSS-v4-06B6D4" />
  <img alt="Drizzle ORM" src="https://img.shields.io/badge/Drizzle-ORM-C5F74F" />
  <img alt="License" src="https://img.shields.io/badge/License-MIT-green" />
</p>

## 产品简介

***Seconda*** 是一个 AI 驱动的模拟面试系统，帮助用户从简历出发完成完整的面试训练闭环：

1. 上传 PDF 简历并结构化解析
2. 配置面试参数（级别、类型、语言、风格、题量）
3. 在面试室逐题作答并获得评分
4. 生成完整评估报告并进行单题深挖复盘

## 核心能力

- 简历驱动出题：问题基于简历内容生成，不虚构经历
- 渐进式面试流程：创建会话预生成 `min(3, total)` 题，答完一题再生成下一题
- 六维评分模型：每题按 6 个维度评分（0-10）并给出改进建议
- 全局评估报告：输出总分（0-100）、雷达维度、优势与重点改进项
- 单题 Deep Dive：支持题目级复盘与教练式强化训练

## 关于名称 | Why "Seconda"

***Seconda*** 源于 ***Second Chair*** 的意象演化。

- ***Second***：不只是“第二个位置”，更是“对席、对面”，是那个认真倾听与追问的存在。
- ***Chair***：是面试桌另一侧的椅子，代表视角转换与思考被检验的空间。

在这里，你坐在第一把椅子上表达自己，而 ***Seconda*** 坐在第二把椅子上，拆解、追问、回应。

它不是给你答案的地方，而是让你看见自己的地方。

每一次回答，都是一次思考的显影。
每一次追问，都是一次认知的加深。

成长并非被告知，而是在被认真对待的提问中完成。

**Sit Across. Think Deeper.**

## 评分模型（6 Dimensions）

| 维度 | 中文 | 说明 |
| --- | --- | --- |
| Understanding | 理解力 | 是否准确理解问题 |
| Expression | 表达力 | 表达是否清晰有条理 |
| Logic | 逻辑性 | 推理和结构是否连贯 |
| Depth | 深度 | 是否具备深入分析能力 |
| Authenticity | 真实性 | 是否基于真实经验作答 |
| Reflection | 反思力 | 是否体现复盘与成长意识 |

- 单题总分：0-10（六维加权）
- 面试总分：0-100

## 快速开始

### 1) 安装依赖

```bash
pnpm install
```

### 2) 配置环境变量

```bash
cp .env.example .env
```

请按需填写以下关键变量：

- `DATABASE_URL`
- `OPENAI_API_KEY`
- `BASE_URL`
- `BASE_MODEL`
- `AUTH_SECRET`

### 3) 执行数据库迁移

```bash
pnpm db:migrate
```

### 4) 启动开发环境

```bash
pnpm dev
```

打开 [http://localhost:3000](http://localhost:3000)

## 目录结构

```text
app/                  # Next.js 路由与页面
components/           # UI 与业务组件
lib/                  # AI、数据库、面试核心逻辑
public/               # 静态资源（含 logo）
```

## License

[MIT LICENSE](./LICENSE)
