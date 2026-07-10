# Seconda 直连厂商的多模型任务路由设计

## 背景

Seconda 已具备固定任务分层、结构化输出校验和候选模型 fallback 的应用层能力，但当前生产适配器依赖 Vercel AI Gateway。该依赖要求单独的 Gateway 鉴权和账户验证，也不适合直接使用团队已有的厂商 API 账户。

本设计将底层调用改为 AI SDK Provider Registry：应用继续控制任务层级、候选顺序、超时、修复与 fallback；模型请求直接发往 DeepSeek、OpenAI 或智谱 AI 中国区。业务模块不感知厂商、Base URL 或 Key。

## 目标

- 简单任务固定使用 fast 层，评分、报告和教练任务固定使用 quality 层。
- 每层只使用一把业务层级 Key：`FAST_MODEL_API_KEY` 与 `QUALITY_MODEL_API_KEY`。
- 支持 `deepseek/*`、`openai/*`、`zhipu/*` 模型标识，并拒绝未知厂商前缀。
- 可恢复故障可在尚未输出任何有效流式内容时切换到下一个候选模型。
- 保留 45 秒总时限、一次 JSON 修复、本地 Zod 复验和不重放已输出流的安全规则。
- 不改变 PRD 定义的六维评分模型、Prompt、数据库结构或面试流程。

## 非目标

- 不按单个任务分别指定七套模型；第一阶段仍只有 fast/quality 两层。
- 不支持同一层级跨厂商 fallback；这需要额外的凭据绑定配置，超出“两把 Key”约束。
- 不实现 LiteLLM、Vercel AI Gateway 或其他托管网关的审计、预算和 Provider 治理功能。
- 不使用 ChatGPT Plus、Claude Pro、GLM Coding Plan 等消费级或专用工具订阅作为通用服务端 API 凭据。

## 方案选择

### 直连厂商 + AI SDK Provider Registry

Provider Registry 将模型前缀映射为对应的 AI SDK Provider：

| 前缀 | Provider | API 根地址 |
| --- | --- | --- |
| `deepseek/*` | OpenAI-compatible Provider | `https://api.deepseek.com` |
| `openai/*` | OpenAI Provider | OpenAI API |
| `zhipu/*` | OpenAI-compatible Provider | `https://open.bigmodel.cn/api/paas/v4/` |

本阶段 GLM 只接入智谱 AI 开放平台中国区；不使用国际版 Z.AI endpoint，也不使用 GLM Coding Plan endpoint。模型名和结构化输出能力必须在上线前通过厂商候选级契约测试。

Registry 必须将 `provider/model` 拆为 Provider 与厂商模型 ID。例如 `deepseek/deepseek-chat` 必须以 `deepseek-chat` 传给 DeepSeek Provider，不能将完整带前缀字符串传给厂商。注入式 Registry 测试必须验证最终请求端点分别为 `https://api.deepseek.com/chat/completions` 与 `https://open.bigmodel.cn/api/paas/v4/chat/completions`。

OpenAI 模型必须通过显式传入所选层级 Key 的 `createOpenAI` 实例构造，不得依赖默认 `OPENAI_API_KEY`。测试应将 `OPENAI_API_KEY` 设为错误值或保持缺失，确认请求仍只使用 `FAST_MODEL_API_KEY` 或 `QUALITY_MODEL_API_KEY`。

### Provider 能力差异

业务层仍只声明 Zod Schema；provider adapter 负责协议差异：

- DeepSeek 的结构化输出按其已验证能力使用 JSON Object 模式，并注入仅用于保证合法 JSON 的 adapter 级指令；除非契约测试确认支持，否则不得假定其支持 OpenAI JSON Schema。
- fast 层 DeepSeek 请求显式关闭 thinking，避免新模型默认思考模式改变延迟和成本；quality 层的 thinking 策略也必须显式配置，不能依赖厂商默认值。
- 智谱与 OpenAI 的结构化输出参数分别通过契约测试确认；不支持的参数不得透传。
- 请求体契约测试必须检查 endpoint、厂商模型 ID、结构化输出模式和 thinking 配置，而不只检查 TypeScript 类型。

### 依赖策略

实施时将 `ai`、现存 Gateway 包和新增 provider 包作为一个兼容性单元处理：

1. 查询实施当日可用的最新稳定版本及 peer dependency 范围。
2. 选择最新、相互兼容且适用于当前 Node/Next.js 环境的稳定版本组合。
3. 先完成依赖升级和 provider 协议/类型冒烟测试，再编写使用新 provider 的生产代码。
4. 不在本设计或实施计划中硬编码 major/minor 版本，也不使用 `--save-exact`；`package.json` 沿用仓库的 semver range 策略，`pnpm-lock.yaml` 记录本次可复现安装的实际解析版本，并在交付报告中列出。
5. 迁移完成后再移除 Gateway 包，避免 provider 包先升级、AI SDK core 仍停留在不兼容版本的中间状态。

### 不采用：继续 Vercel AI Gateway

保留 Gateway 可减少厂商适配工作，但无法满足直连已有厂商 API 账户的目标。

### 不采用：自建完整 Gateway

自行实现密钥托管、预算、Provider 协议和审计会显著扩大本次范围。若未来需要集中治理，应将当前 Provider Registry Adapter 替换为 LiteLLM Proxy，而不是在 Seconda 中重建网关。

## 配置模型

```env
FAST_MODEL_API_KEY=fast-tier-provider-api-key
QUALITY_MODEL_API_KEY=quality-tier-provider-api-key

AI_MODEL_FAST=deepseek/deepseek-chat
AI_MODEL_QUALITY=zhipu/glm-5.1
AI_MODEL_QUALITY_FALLBACK=zhipu/glm-4.7
AI_APPROVED_MODELS=deepseek/deepseek-chat,zhipu/glm-5.1,zhipu/glm-4.7
```

以上模型 ID 是配置格式示例，不是永久锁定的型号。实施和部署时必须从厂商中国区可用模型列表确认当前 ID，并由候选级契约测试验证。

模型标识遵循 `provider/model`。`AI_APPROVED_MODELS` 是模型准入名单；每个已配置模型必须位于其中，且所有已配置候选不得重复。

凭据与候选槽位绑定，而不是与厂商环境变量绑定：

- fast 主/备用候选使用 `FAST_MODEL_API_KEY`。
- quality 主/备用候选使用 `QUALITY_MODEL_API_KEY`。
- fast 主/备用必须具有相同 Provider 前缀；quality 主/备用也必须具有相同 Provider 前缀。
- fast 候选耗尽后升级到 quality 候选，此时改用 `QUALITY_MODEL_API_KEY`。

例如，fast 使用 DeepSeek、quality 使用智谱时，DeepSeek fast 主/备用失败后将升级到智谱 quality 主/备用。若两个层级均使用同一厂商，两个环境变量可以配置为同一把厂商 API Key。

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
fast 任务：fast 主 →（可选 fast 备用）→ quality 主 →（可选 quality 备用）
quality 任务：quality 主 →（可选 quality 备用）
```

候选对象必须保留其凭据层级，避免将 DeepSeek Key 错用于 OpenAI/智谱请求。

## 非流式调用

`generateStructured(task, schema, system, prompt)` 继续是业务层唯一入口：

1. 根据任务解析带凭据层级的候选模型。
2. 由 Provider Registry 构造相应 Language Model。
3. 禁用 AI SDK 内建重试；应用层统一控制一次修复、一次瞬时重试和候选切换。
4. 最终结果始终经本地 `schema.parse` 验证。

错误分类：

- 结构化输出错误与 Zod 错误：一次全局修复机会，失败后切换候选。
- 408、429、5xx、已识别网络错误：同模型一次带抖动重试，随后切换候选。
- 无 HTTP 状态但 AI SDK 标记 `isRetryable` 的 `APICallError`：按瞬时错误处理。
- 除 408/429 以外的所有有状态 4xx（包括模型名/请求参数错误）、内容安全拒绝及未知编程错误：立即失败，不盲目切换。

总执行时间仍为 45 秒，覆盖修复、重试和所有候选尝试。

## 流式下一题生成

保留既有 NDJSON 和部分题目输出体验，不降级为请求—响应。

`streamStructured` 对业务层只暴露最小接口 `{ partialOutputStream, output }`，不伪装成完整 `StreamTextResult`。它使用与非流式相同的 45 秒总 deadline，并接受两个业务回调：`isUsablePartial` 定义“已向用户输出”的边界，`validateFinal` 在任何未提交的最终对象进入 committed 前执行语义校验。

1. 主候选在产生首个有效片段前失败，且错误可恢复：终止该尝试并启动下一个候选。
2. 首个有效片段即将发送给客户端：先将该流标记为 committed。
3. committed 后发生任何错误：向客户端报告错误，不切换、不重放、不拼接第二个模型的输出。

下一题路由将“相对上一次已发送 partial，`question`、`topic` 或 `tip` 出现新的非空白字符串”视为有效片段。空白和重复 partial 不构成提交。必须先设置 committed，再将 partial 写入 NDJSON，防止写入竞争触发错误 fallback。

每次候选尝试使用独立的 `AbortController`，与调用方信号和全局 deadline 组合。准备 retry/fallback 前必须 abort 或 cancel 上一个流，防止失败候选继续生成和计费；候选级中断不得取消全局 deadline。

AI SDK 可能把 provider 故障转换为流 error part，而不是直接让 `partialOutputStream` 抛出原始错误。因此 adapter 必须通过 `streamText.onError` 捕获原始 `APICallError`，并在分类时优先使用它；不能只依赖 `output` 最终抛出的 `NoOutputGeneratedError`。

候选在 committed 前的结果规则如下：

- 首个有效 partial 前发生瞬时错误、结构化错误或本地 schema 校验失败：按全局一次修复、同模型一次瞬时重试和候选顺序继续。
- 没有 partial 但最终完整对象通过 schema 和 `validateFinal`：标记 committed，并把完整对象交给既有路由的最终发送逻辑。
- 没有 partial 且最终对象无效或请求失败：不向客户端写入内容，继续 repair/retry/fallback。
- committed 后的任何请求、解析或 schema 错误：不再启动候选；仅向客户端报告错误，且不得写入题目数据库。

下一题路由传入的 `validateFinal` 必须要求 `question.trim()` 非空。无 partial 的空题在提交前进入 repair/fallback；若此前已经输出过 `topic` 或 `tip`，则流已经 committed，最终空题只能报错且不得 fallback 或写库。`topic`、`tip` 是否必填沿用现有产品 Schema，不借此次路由改造扩大业务规则。

## 启动校验与隐私

Node.js 启动时：

- 校验模型标识、批准名单、重复项与同层 Provider 一致性。
- 因为 fast 和 quality 主模型都必填，始终要求 `FAST_MODEL_API_KEY` 与 `QUALITY_MODEL_API_KEY` 均为非空。
- Edge runtime 跳过校验，因为 AI Route Handler 运行在 Node.js。

API Key 只由服务端 Provider Registry 读取，禁止写入客户端环境变量、Prompt、响应或日志。所有 AI 调用路径必须将 provider 错误转换为同一个 provider-neutral 安全摘要；日志、API 响应和任何持久化错误字段都只能使用该摘要，不得保存或返回原始 `error.message`、request/response body 或 headers。不得直接 `console.error(error)`，因为 `APICallError` 可能携带包含简历、回答或 Key 的请求体。测试使用 sentinel 简历、回答和 Key，断言日志、响应与持久化写入均只保留安全的错误类别、HTTP 状态、provider/model 和 request ID。

## 测试与发布

- 单元测试：层级映射、前缀与 Key 绑定、候选顺序、状态缺失错误分类、流式提交边界、候选中断、空题目拒绝和日志清洗。
- 请求契约测试：用注入 fetch/local SSE fixture 对每个已配置候选验证 endpoint、模型 ID、结构化输出与 thinking 参数；quality 候选也要通过 fast 任务 Schema，因为 fast 会升级到 quality。
- 确定性集成测试：本地 fixture 模拟首片段前 429/5xx、AI SDK stream error part、首片段后错误和 abort；普通 `pnpm test` 不访问真实厂商、不产生费用。
- 在线契约冒烟：独立、显式 opt-in 的命令使用有效非生产 Key 和虚构数据，逐候选验证所有适用 Schema；成功路径用于确认厂商当前模型能力，不依赖人为制造线上 429/5xx。
- 构建验证：使用格式合法但非真实的模型与层级 Key 运行 clean build；启动校验不应触发外部 API 请求。

## 延期工作

模型/Prompt/Schema 快照、creating/failed 生命周期与幂等、确定性报告分数聚合、持久化 AI 调用审计、黄金数据集评测和动态复杂度路由继续作为独立项目处理。
