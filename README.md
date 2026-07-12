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
2. 配置面试语言、面试官风格与面试偏好
3. 在连续的 Agent 面试中自我介绍、作答并接受深入追问
4. 生成完整评估报告并进行单题深挖复盘

## 核心能力

- 简历驱动出题：问题基于简历内容生成，不虚构经历
- 有界 Agent 面试：根据简历和回答自主选择追问、切换主题或结束，同类最多 3 题、全局最多 20 轮
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
- `INTERVIEW_AGENT_V2_ENABLED`
- `FAST_MODEL_API_KEY`
- `QUALITY_MODEL_API_KEY`
- `AI_MODEL_FAST`
- `AI_MODEL_FAST_FALLBACK`
- `AI_MODEL_QUALITY`
- `AI_MODEL_QUALITY_FALLBACK`
- `AI_APPROVED_MODELS`
- `AUTH_SECRET`

AI 调用直接使用厂商 API，模型标识仅支持 `deepseek/*`、`openai/*` 和 `zhipu/*`。每层使用自己的 Key：fast 候选使用 `FAST_MODEL_API_KEY`，quality 候选使用 `QUALITY_MODEL_API_KEY`；同一层的主/备用候选必须属于同一厂商。fast 任务会依次尝试 fast 主模型、fast 备用模型，再升级到 quality 模型；quality 任务只会在 quality 主/备用模型之间切换，绝不降级到 fast。`AI_APPROVED_MODELS` 只能包含已通过结构化输出和评分一致性审核的模型。智谱仅使用中国区开放平台：`https://open.bigmodel.cn/api/paas/v4/`；示例模型 ID 部署前须以中国区当前模型列表和候选级契约测试确认。

### Agent v2 开关

Agent 面试现为新建会话的默认路径，并开放以下版本化 API。`INTERVIEW_AGENT_V2_ENABLED=false` 仅作为紧急回滚开关；未配置或设为 `true` 时启用：

```text
POST /api/interviews
POST /api/interviews/:id/messages
POST /api/interviews/:id/end
GET  /api/interviews/:id/runs/:runId/events?after=<sequence>
POST /api/interviews/:id/runs/:runId/resume
```

Agent Run、事件、消息和覆盖度会持久化到 PostgreSQL。消息提交返回 `202` 后，由持有 30 秒数据库租约的 Worker 执行；默认每 10 秒续租。租约过期的 Run 可通过 `resume` 接口重新调度，同一时刻只有一个 Worker 能成功 claim。

事件接口使用 SSE，并通过 `after` sequence 重放断线期间的持久化事件。业务空闲 10 秒会发送不落库的 heartbeat。模型流 25 秒没有 token 或工具进展会触发 provider idle timeout。瞬时错误采用 500ms 起始、2 倍增长、8 秒封顶的 full-jitter 退避，每个模型最多重试 2 次。

Run 的成功与失败都会先持久化唯一终态事件。终态连接不会重连；仅网络异常最多自动重连 5 次，之后显示手动重试。`run_failed` 会撤销尚未提交的 provisional 内容，同时保留已提交消息。

`text_delta` 是 provisional 内容；只有收到 `message_committed` 后才是正式消息。一旦 provisional 内容已展示，该 Run 不会静默切换模型或把另一个 attempt 的文本拼接到同一消息。

Agent 上下文采用 cache-stable Prompt Pipe。面试设置、简历概览与证据目录、当前 checkpoint 位于稳定前缀；最近消息和本轮指令只追加在增量尾部。普通轮次不会改变 `cacheEpoch`，每 5 个候选人回答轮次或上下文达到有效预算的 90% 时才生成新 checkpoint。压缩只读取上个 checkpoint 之后的完整消息组，首次超长会截断最旧的完整组重试，连续 3 次失败后以 `prompt_too_long` 终止。

`INTERVIEW_AGENT_CONTEXT_WINDOW` 默认 `128000`，`INTERVIEW_AGENT_OUTPUT_RESERVE` 默认 `8000`；运行时还固定保留 20% headroom。最近尾部最多保留 8 条消息。每个 Run 记录 prompt 模板版本、cache epoch、估算上下文 token，以及厂商实际返回的 input/output/cache-read/cache-write token。厂商未提供 cache 字段时保留为“不可用”语义，监控中不得按 0 命中计算；跨厂商或模型降级也不假设缓存可复用。

Agent Skills 位于 `lib/interview/agent/skills.ts`。每个 Skill 必须声明稳定名称、版本、简短元数据、最多 4000 字符的指令和所需工具；启动时会拒绝重名 Skill 与不存在的工具。Opening Run 只加载简历证据和覆盖规划，Answer Run 再按需加载六维评估 Skill。模型只看到当前 Skill 所需工具的并集，完整工具注册表仍保留在服务端执行管线中；激活的 Skill 名称会进入 checkpoint，恢复后按 Run mode 确定性重载。

Dashboard 默认创建 v2 Agent 面试并使用可恢复 SSE 面试室。历史 v1 会话仍按其持久化 `configVersion` 使用 legacy 页面读取；关闭回滚开关会让 Agent 写入与事件 API 返回 404，但不会删除已有 v2 数据。

迁移完成后，v1 新建、回答、下一题和完成接口统一返回 `410 Gone`。已完成的 v1 会话、问题、评分、报告和分享链接继续可读；尚未完成的 v1 房间会显示只读迁移提示。

使用已解析且归属于测试用户的简历版本执行 live contract：

```bash
INTERVIEW_AGENT_TEST_RESUME_VERSION_ID=<uuid> pnpm test:interview:agent
pnpm test:interview:failure
```

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
