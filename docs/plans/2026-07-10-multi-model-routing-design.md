# Seconda 多模型任务路由设计

## 背景

Seconda 当前所有 AI 能力共用一个 `chatLanguageModel`。这使模型切换简单，但存在三个生产问题：不同任务无法按成本和质量分层、单个模型故障会影响全部流程、评分模型变更可能导致同一场面试的评分口径漂移。

本设计采用“应用内任务路由层 + 托管统一网关”。应用负责定义任务、质量层级和一致性规则；Vercel AI Gateway 负责供应商协议适配、模型和 Provider 路由、故障转移及用量治理。

## 目标

- 简单任务固定使用小模型，复杂任务固定使用大模型。
- 业务代码不直接依赖模型厂商 SDK、Base URL 或模型名称。
- 保持同一场面试的评分模型、Prompt 和 Schema 版本稳定。
- 对限流、短暂故障和结构化输出失败提供可控的重试与降级。
- 记录足够的调用元数据，用于质量回归、成本分析和事故排查。

## 非目标

- 第一阶段不使用模型自动判断请求复杂度。
- 第一阶段不根据实时价格或延迟动态选择模型。
- 不改变 PRD 定义的六维评分模型和面试流程。
- 不允许任意未经验证的模型直接进入生产路由。

## 方案对比

### 业务代码直连多个厂商

每个厂商使用自己的 SDK。短期直接，但业务代码会感知不同的鉴权、结构化输出、错误和流式协议，维护与测试成本随模型数量增长。

### 应用自行实现全部协议兼容

可以避免第三方网关依赖，但需要长期跟进各厂商 API 变化。团队需要自行实现路由、熔断、预算、日志和协议转换。

### 应用任务路由层 + 托管网关

应用保留业务策略和可替换接口，网关承担供应商兼容与基础设施能力。该方案在当前 Next.js、AI SDK 6 技术栈下具有最好的维护性、稳定性和扩展性，因此作为第一阶段方案。

## 架构

```text
Resume / Interview / Report APIs
              |
              v
      generateStructured(task)
              |
              v
        Task Model Policy
         /            \
      fast           quality
         \            /
              v
       Vercel AI Gateway
              |
              v
     Approved Model Providers
```

业务模块只传入任务名、Prompt 和 Zod Schema。统一 AI 层选择模型、执行请求、验证结果并记录调用元数据。

## 任务与层级

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

第一阶段映射如下：

| 任务 | 层级 | 原因 |
| --- | --- | --- |
| `resume.parse` | fast | 以抽取和格式转换为主，结果受 Schema 约束 |
| `question.generate` | fast | 约束明确、单次输出短 |
| `question.follow-up` | fast | 基于已有不足生成一个追问 |
| `answer.score` | quality | 直接影响六维评分与用户信任 |
| `report.generate` | quality | 需要综合整场面试信息 |
| `coach.generate` | quality | 需要准确解释知识与误区 |
| `coach.evaluate` | quality | 涉及再次评分与反馈一致性 |

模型名称只存在于环境配置或集中配置模块：

```env
AI_MODEL_FAST=creator/small-model
AI_MODEL_FAST_FALLBACK=creator/backup-small-model
AI_MODEL_QUALITY=creator/large-model
AI_MODEL_QUALITY_FALLBACK=creator/backup-large-model
```

生产启动时必须校验所有必需配置。缺失、重复或未通过能力验证的模型应阻止部署进入就绪状态。

## 路由与降级

- fast 主模型出现可重试错误或结构化输出失败时，先尝试 fast 备用模型，仍失败可升级到 quality 模型。
- quality 主模型失败时，只能切换到经过评分一致性验证的 quality 备用模型，不得降级到 fast。
- 鉴权失败、请求参数错误和内容安全拒绝不做盲目重试。
- 429、超时和 5xx 采用有限次数、带抖动的指数退避。
- 每次调用设置总时限，避免一次请求因多层重试长时间占用 Route Handler。
- fallback 成功仍要记录原始失败原因，便于发现主模型持续退化。

## 评分一致性

创建面试时保存一份 AI 执行快照，至少包含：

- `questionModel`
- `scoringModel`
- `promptVersion`
- `schemaVersion`
- `routingPolicyVersion`

同一场面试的单题评分固定使用该快照。模型退役时，已有面试按明确迁移规则处理，不能在无记录的情况下静默切换。

报告中的总分和六维平均分应由应用根据已保存的单题得分确定性计算。大模型只生成优势、改进方向、总结和建议，避免模型重新计算数值造成漂移。

## 结构化输出

所有现有 AI 任务都依赖结构化结果。统一调用层必须：

1. 使用任务对应的 Zod Schema。
2. 让 Gateway 和 AI SDK 处理 Provider 协议差异。
3. 对最终结果再次本地校验。
4. 对可修复的 JSON 格式问题最多执行一次修复。
5. 修复失败后切换兼容备用模型，不将部分对象写入数据库。

候选模型上线前必须通过各任务 Schema 的契约测试，不能只依据厂商宣称的“支持 JSON”。

## 数据与审计

每次 AI 调用记录以下元数据，但默认不持久化完整简历或回答 Prompt：

- task、environment、interviewId 或 resumeVersionId
- requestedModel、servedModel、provider
- promptVersion、schemaVersion、routingPolicyVersion
- latency、inputTokens、outputTokens、estimatedCost
- retryCount、fallbackCount、finishReason、errorCategory
- Gateway request ID 和应用 correlation ID

简历和面试回答包含个人信息。生产日志应默认脱敏，禁用无必要的 Prompt/Response 全文记录，并通过 Provider allowlist、数据保留策略和无训练策略限制数据去向。

## 生命周期与幂等

当前创建面试流程先写入 `active` interview，再调用 AI 生成题目。AI 失败时可能留下没有题目的活动面试。

生产流程应改为：

1. 创建 `creating` 状态的面试并生成幂等键。
2. 调用 AI 生成首批题目。
3. 在数据库事务中写入题目并将状态更新为 `active`。
4. 最终失败时将面试标记为 `failed`，允许相同幂等键安全重试。

评分提交、报告生成和下一题生成也需要避免用户重试产生重复记录。数据库唯一约束继续作为最后防线。

## 质量发布流程

模型不是通过修改生产环境变量直接上线，而是按以下流程晋级：

1. 使用固定简历、问题和回答构成黄金数据集。
2. 验证 Schema 成功率、延迟、成本和内容质量。
3. 对评分模型比较六维得分偏差和排序一致性。
4. 先进行影子调用，不影响用户结果。
5. 小比例灰度后再更新正式策略版本。
6. 保留快速回滚到上一策略版本的能力。

## 可观测性与告警

按 task、model 和 provider 监控：

- 成功率和 Schema 校验失败率
- P50、P95、P99 延迟
- 429、5xx、超时和 fallback 比例
- 每次调用及每场面试成本
- fast 升级到 quality 的比例
- 评分分布与版本切换前后的漂移

对连续主模型故障、fallback 激增、成本异常和评分分布突变设置告警。

## 成本与容量

- fast 与 quality 使用独立预算和调用指标。
- 对用户和接口设置速率限制，防止重复提交或恶意消耗。
- 限制最大简历文本、回答长度和历史轮数，避免不可控上下文成本。
- 仅对无用户差异且不包含个人信息的内容使用缓存。
- 报告等高成本任务应避免在客户端重试时重复生成。

## 测试策略

- 单元测试：任务到层级映射、错误分类、重试和 fallback 顺序。
- 契约测试：每个候选模型对所有相关 Zod Schema 的通过率。
- 集成测试：Gateway 路由、超时、Provider 故障和备用模型切换。
- 数据库测试：creating/active/failed 状态、事务和幂等约束。
- 回归评测：六维评分一致性、问题与简历关联性、报告内容质量。
- 隐私测试：日志和遥测中不出现简历原文、回答全文或 API Key。

## 后续演进

只有在固定任务分层已有稳定数据后，才考虑第二阶段的动态复杂度路由。动态路由应首先应用于问题生成或教练内容，不应直接用于单题评分。若未来需要私有部署、多产品共享或更强租户治理，可在不改变业务接口的情况下将 Gateway Adapter 替换为 LiteLLM Proxy。
