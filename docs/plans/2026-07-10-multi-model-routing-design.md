# Seconda 直连厂商的多模型任务路由设计

## 背景

Seconda 已具备固定任务分层、结构化输出校验和候选模型 fallback 的应用层能力，但当前生产适配器依赖 Vercel AI Gateway。该依赖要求单独的 Gateway 鉴权和账户验证，且不适合直接使用团队已有的厂商 API 账户。

本设计将底层调用改为 AI SDK Provider Registry：应用仍控制任务层级、候选顺序、超时、修复与 fallback；各模型请求则直接发往 DeepSeek、OpenAI 或 Z.AI/GLM。业务模块不感知厂商、Base URL 或 Key。

## 目标

- 简单任务固定使用 fast 层，评分、报告和教练任务固定使用 quality 层。
- 每层只使用一把业务层级 Key：`FAST_MODEL_API_KEY` 与 `QUALITY_MODEL_API_KEY`。
- 支持 `deepseek/*`、`openai/*`、`zai/*` 模型标识，并拒绝未知厂商前缀。
- DeepSeek 等可恢复故障可在未输出任何流式内容前切换到下一个候选模型。
- 保留现有 45 秒总时限、一次 JSON 修复、本地 Zod 复验和不重放已输出流的安全规则。
- 不改变 PRD 定义的六维评分模型、Prompt、数据库结构或面试流程。

## 非目标

- 不按单个任务分别指定七套模型；第一阶段仍只有 fast/quality 两层。
- 不支持同一层级跨厂商 fallback；这需要额外的凭据绑定配置，超出“两把 Key”约束。
- 不实现 LiteLLM、Vercel AI Gateway 或其他托管网关的审计、预算和 Provider 治理功能。
- 不使用 ChatGPT Plus、Claude Pro、GLM Coding Plan 等消费级/专用工具订阅作为通用服务端 API 凭据。

## 方案选择

### 直连厂商 + AI SDK Provider Registry

Provider Registry 将模型前缀映射为对应的 AI SDK Provider：

| 前缀 | Provider | 接口 |
| --- | --- | --- |
| `deepseek/*` | OpenAI-compatible Provider | `https://api.deepseek.com` |
| `openai/*` | OpenAI Provider | OpenAI API |
| `zai/*` | OpenAI-compatible Provider | `https://api.z.ai/api/paas/v4/` |

Z.AI 的 Coding endpoint 仅用于编码场景，不用于 Seconda 的通用面试任务。模型名与接口能力必须在上线前通过结构化输出契约测试。

Registry 必须将 `provider/model` 拆为 Provider 与厂商模型 ID。例如 `deepseek/deepseek-v4-flash` 必须以 `deepseek-v4-flash` 传给 DeepSeek Provider，不能将完整带前缀字符串传给厂商。注入式 Registry 测试必须验证最终请求端点分别为 `https://api.deepseek.com/chat/completions` 与 `https://api.z.ai/api/paas/v4/chat/completions`。

此方案保留当前应用内路由的可测试性，并移除 Vercel Gateway 鉴权、账户验证及专属流式参数依赖，因此作为本次改造方案。

### 不采用：继续 Vercel AI Gateway

保留 Gateway 可减少厂商适配工作，但无法满足直连已有厂商 API 账户的目标。

### 不采用：自建完整 Gateway

自行实现密钥托管、预算、Provider 协议和审计会显著扩大本次范围。若未来需要集中治理，应将当前 Provider Registry Adapter 替换为 LiteLLM Proxy，而不是在 Seconda 中重建网关。

## 配置模型

```env
FAST_MODEL_API_KEY=fast-tier-provider-api-key
QUALITY_MODEL_API_KEY=quality-tier-provider-api-key

AI_MODEL_FAST=deepseek/deepseek-v4-flash
AI_MODEL_FAST_FALLBACK=deepseek/deepseek-v4-pro
AI_MODEL_QUALITY=zai/glm-5.1
AI_MODEL_QUALITY_FALLBACK=zai/glm-5
AI_APPROVED_MODELS=deepseek/deepseek-v4-flash,deepseek/deepseek-v4-pro,zai/glm-5.1,zai/glm-5
```

模型标识遵循 `provider/model`。`AI_APPROVED_MODELS` 是模型准入名单；每个已配置模型必须位于其中，且四个已配置模型不得重复。

凭据与候选槽位绑定，而不是与厂商环境变量绑定：

- fast 主/备用候选使用 `FAST_MODEL_API_KEY`。
- quality 主/备用候选使用 `QUALITY_MODEL_API_KEY`。
- 因此 fast 主/备用必须具有相同 Provider 前缀；quality 主/备用也必须具有相同 Provider 前缀。
- fast 候选耗尽后升级到 quality 候选，此时改用 `QUALITY_MODEL_API_KEY`。

例如，fast 使用 DeepSeek、quality 使用 OpenAI 时，DeepSeek fast 主/备用失败后将升级到 OpenAI quality 主/备用。若两个层级均使用同一厂商，两个环境变量可以配置为同一把厂商 API Key。

## 任务与路由

```ts
type AITask =
  | "resume.parse"
  | "question.generate"
  | "question.follow-up"
  | "answer.score"
  | "report.generate"
  | "coach.generate"
  | "coach.evaluate";
```

| 任务 | 层级 |
| --- | --- |
| `resume.parse` | fast |
| `question.generate` | fast |
| `question.follow-up` | fast |
| `answer.score` | quality |
| `report.generate` | quality |
| `coach.generate` | quality |
| `coach.evaluate` | quality |

候选顺序固定：

```text
fast 任务：fast 主 → fast 备用 → quality 主 → quality 备用
quality 任务：quality 主 → quality 备用
```

候选对象必须保留其凭据层级，避免将 DeepSeek Key 错用于 OpenAI/GLM 请求。

## 非流式调用

`generateStructured(task, schema, system, prompt)` 继续是业务层唯一入口：

1. 根据任务解析带凭据层级的候选模型。
2. 由 Provider Registry 构造相应 Language Model。
3. 禁用 AI SDK 内建重试；应用层统一控制一次修复、一次瞬时重试和候选切换。
4. 最终结果始终经本地 `schema.parse` 验证。

错误分类：

- 结构化输出错误与 Zod 错误：一次全局修复机会，失败后切换候选。
- 408、429、5xx、已识别网络错误：同模型一次带抖动重试，随后切换候选。
- 除 408/429 以外的所有 4xx（包括模型名/请求参数错误）、内容安全拒绝及未知编程错误：立即失败，不盲目切换。

总执行时间仍为 45 秒，覆盖修复、重试和所有候选尝试。

## 流式下一题生成

保留既有 NDJSON 和部分题目输出体验，不降级为请求—响应。

`streamStructured` 使用与非流式相同的 45 秒组合 deadline，并将调用方中断信号传给每一次候选尝试。它逐个启动候选流，并接受 `isUsablePartial` 回调来定义“已向用户输出”的边界：

1. 主候选在产生首个有效片段前失败，且错误可恢复：启动下一个候选。
2. 首个有效片段已发送给客户端：该流成为已提交流。
3. 已提交流之后发生错误：直接向客户端报告错误，不切换、不重放、不拼接第二个模型的输出。

下一题路由将“相对上一次已发送 partial，`question`、`topic` 或 `tip` 出现新的非空白字符串”视为有效片段。必须先设置 committed 标记，再将该 partial 写入 NDJSON，防止重复 partial 或写入竞争触发错误 fallback。

候选在 committed 前的结果规则如下：

- 首个有效 partial 前发生瞬时错误、结构化错误或本地 schema 校验失败：按全局一次修复、同模型一次瞬时重试和候选顺序继续。
- 没有 partial 但最终完整对象通过 schema：将该候选标记为 committed，并把完整对象交给既有路由的最终发送逻辑。
- 没有 partial 且最终对象无效或请求失败：不向客户端写入内容，继续上述修复/retry/fallback。
- committed 后的任何请求、解析或 schema 错误：不再启动候选；仅向客户端报告错误，且不得写入题目数据库。

## 启动校验与隐私

Node.js 启动时：

- 校验模型标识、批准名单、重复项与同层 Provider 一致性。
- 因为 fast 和 quality 主模型都必填，始终要求 `FAST_MODEL_API_KEY` 与 `QUALITY_MODEL_API_KEY` 均为非空。
- Edge runtime 跳过校验，因为 AI Route Handler 运行在 Node.js。

API Key 只由服务端 Provider Registry 读取，禁止写入客户端环境变量、Prompt、响应或日志。默认不记录简历原文和候选人回答全文。

## 测试与发布

- 单元测试：层级映射、模型前缀、Key 绑定、候选顺序、错误分类和流式提交边界。
- 契约测试：每个批准模型对其相关 Zod Schema 的成功率。
- 集成测试：DeepSeek 首片段前 429/5xx → quality fallback；首片段后错误不 fallback。
- 冒烟测试：使用有效的非生产厂商 API Key 与虚构简历、回答执行全部七个任务，确认实际请求走预期厂商与模型。

## 延期工作

模型/Prompt/Schema 快照、creating/failed 生命周期与幂等、确定性报告分数聚合、持久化 AI 调用审计、黄金数据集评测和动态复杂度路由继续作为独立项目处理。
