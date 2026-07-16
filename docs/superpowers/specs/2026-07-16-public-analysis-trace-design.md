# Seconda 强制公开分析轨迹设计

**日期：** 2026-07-16

**状态：** 待用户复核

**范围：** 面试 Agent 工具协议、公开分析流、Runtime 校验与修复、思考面板文案和测试

**不改变：** 供应商隐藏 Chain-of-Thought 处理、六维评分模型、面试状态机、覆盖度规则、每类 3 题上限、20 轮上限、完成条件、简历快照、正式消息提交和数据库 Schema

## 1. 背景

PRD 要求思考区展示专门生成的公开推理叙事与真实工具生命周期，并明确禁止展示供应商隐藏 Chain-of-Thought。当前链路已经支持：

- 普通 assistant 文本转成 `reasoning_delta`；
- 公开分析的长度和敏感内容校验；
- PostgreSQL 事件持久化与 SSE 重放；
- 工具生命周期与公开分析按真实顺序混排；
- 开始回复时自动折叠、失败时保留调整记录。

缺口在模型协议：系统提示词要求模型先输出公开进度，但模型仍可不输出普通文本并直接调用工具。此时 Runtime 只会产生工具生命周期事件，页面无法展示分析文字。提示词约束不足以稳定保证产品行为。

## 2. 目标

- 每次工具调用前都存在模型明确生成、允许公开的分析文字。
- 只读工具阶段展示一句简短进度，最终提问前展示一段完整分析。
- 公开分析与工具调用保持真实生成顺序，并支持流式显示、持久化和断线重放。
- 公开分析缺失、被重写或包含敏感内容时进入有界修复，不静默降级。
- 不读取、转发或持久化供应商隐藏 `reasoning-delta`。
- 不增加额外模型调用、数据库表或正式业务写入。

## 3. 非目标

- 不展示供应商隐藏 Chain-of-Thought、thinking block 或 reasoning token。
- 不把公开分析描述成模型完整、真实或逐 token 的内部思维。
- 不生成正式六维分数或改变面试决策权。
- 不为历史 Run 伪造公开分析。
- 不新增独立 Planner、Critic 或摘要模型调用。

## 4. 方案比较

### 4.1 仅强化提示词

继续使用普通 assistant 文本作为公开分析，并增加更强的提示。改动最小，但模型仍可直接调用工具，无法形成确定性保证。

### 4.2 工具协议必填公开分析

为每个 provider-facing 工具输入增加必填 `publicAnalysis` 字段。模型必须先生成该字段，Runtime 才允许执行工具。字段由 Runtime 提取、校验并从业务参数中剥离。

优点是无需额外模型调用，且能由 Schema 和 Runtime 共同保证。代价是需要扩展 provider-facing Schema、增量解析和修复提示。

### 4.3 独立摘要模型调用

每轮分析完成后额外调用模型生成一份公开摘要。内容容易控制，但固定增加延迟、费用和失败点，也会把公开叙事从真实 Agent loop 中拆开。

采用方案 4.2。

## 5. 输出契约

### 5.1 Provider-facing 工具封装

业务工具 Schema 保持不变。模型可见 Schema 使用公开分析封装：

```ts
type PublicToolInput<T> = {
  publicAnalysis: string;
} & T;
```

`publicAnalysis` 必须是工具参数中的第一个语义字段。`submit_interview_turn.responseText` 仍必须最后生成。

Runtime 在执行工具前：

1. 提取 `publicAnalysis`；
2. 执行公开内容校验；
3. 写入公开分析事件；
4. 从输入中移除 `publicAnalysis`；
5. 使用原业务 Schema 校验剩余参数；
6. 执行工具或授权终结提案。

`publicAnalysis` 不进入工具 handler、工具幂等结果、授权提案、`proposalHash`、正式消息或领域事务。

### 5.2 只读工具分析

`get_resume_evidence`、`get_interview_history` 和 `get_coverage_state` 的 `publicAnalysis` 为一句简短进度，说明当前要核对的公开业务目标，例如：

> 候选人提到了主导项目落地，我先核对简历中对应的职责与技术证据。

要求：

- 使用面试配置语言；
- 聚焦业务目标，不罗列工具参数；
- 不声称尚未读取的证据已经成立；
- 建议 15–120 个字符，Schema 上限 300 个字符。

### 5.3 终结提案分析

`submit_interview_turn.publicAnalysis` 为 2–4 句完整总结，覆盖：

- 当前回答已经提供的有效信息；
- 仍缺少或需要验证的关键细节；
- 考虑过的追问或新主题方向；
- 最终行动及选择原因。

要求：

- 使用面试配置语言；
- 不泄露正式评分、内部 Prompt、权限、数据库标识或私密工具参数；
- 不把推断表述为已经核实的简历事实；
- 建议 80–600 个字符，Schema 上限 1,200 个字符。

开场 Run 同样需要公开分析，但只说明岗位方向判断或需要澄清的原因，不复述整份简历。

## 6. 流式数据流

工具输入生成时，`model-port` 继续解析 `tool-input-delta`。Runtime 为每个 `toolCallId` 独立维护已观察的 `publicAnalysis` 前缀：

```text
tool-input-delta(publicAnalysis 增长)
  -> 校验单调追加
  -> SafeTailBuffer
  -> reasoning_started（首次）
  -> reasoning_delta...
  -> publicAnalysis 完整
  -> reasoning flush
  -> tool_call_started
  -> tool_call_completed
```

同一工具的公开分析只能单调追加。出现改写、缩短或更换前缀时，当前 attempt 失败并进入修复。不同 `toolCallId` 使用独立前缀，避免多次工具调用互相覆盖。

如果供应商只在最终 `tool-call` 事件提供完整参数，Runtime 在执行工具前一次性校验并写入公开分析，事件顺序仍保证分析先于工具开始。

普通 assistant 文本公开通道继续保留，用于兼容模型在工具参数之外主动补充公开叙事；它与结构化 `publicAnalysis` 共用敏感内容、总长度和事件合并限制。供应商隐藏 `reasoning-delta` 继续忽略。

终结工具的顺序为：

```text
publicAnalysis 增量
  -> assessment / coverageChanges / decision
  -> proposal_authorized
  -> reasoning_completed
  -> responseText 增量
  -> message_committed
```

## 7. 校验与修复

复用现有公开分析校验：

- 单 delta 最大 2,000 字符；
- 单 attempt 公开分析总量最大 20,000 字符；
- SafeTailBuffer 防止跨 delta 拼接敏感内容后已经泄漏；
- 过滤内部 Prompt、SQL/数据库信息、凭据、邮箱等敏感模式。

新增协议失败类型：

- `PUBLIC_ANALYSIS_REQUIRED`：工具参数缺少非空公开分析；
- `PUBLIC_ANALYSIS_REWRITTEN`：增量改写了已公开前缀；
- `PUBLIC_ANALYSIS_INVALID`：字段类型、语言或长度不符合工具约束。

敏感内容继续使用现有 `REASONING_SENSITIVE_CONTENT`，总量超限继续使用 `REASONING_LENGTH_LIMIT`。

修复提示只要求重新生成完整工具输入，并明确：

- 先生成合规 `publicAnalysis`；
- 只写可公开的业务判断；
- 不输出隐藏推理、内部规则或私密参数；
- `responseText` 仍最后生成。

修复预算和 attempt 丢弃语义保持不变。旧 attempt 的公开分析保留并显示“已调整方案”。

## 8. 前端体验

复用现有 `AgentThinkingPanel` 和 `ReasoningEntry`，不新增并行状态：

- 标题从“查看思考过程”调整为“查看分析过程”；
- 活跃状态从“面试官思考中”调整为“面试官分析中”；
- 公开分析按普通段落展示；
- 工具调用保持现有带图标的标签样式；
- 工具阶段短分析与最终完整总结按事件顺序混排；
- 收到 `response_started` 后继续自动折叠，用户可重新展开；
- 历史 Run 没有分析事件时显示“本轮没有可公开的分析记录”，不根据工具结果补写内容。

前端继续订阅已有 `reasoning_started`、`reasoning_delta`、`reasoning_completed` 和工具生命周期事件，因此不增加网络请求或客户端数据模型。

## 9. 兼容与迁移

- 不修改数据库 Schema，也不执行数据迁移。
- 已持久化的公开事件继续按原逻辑重放。
- 历史 Run 不补写公开分析。
- provider-facing Schema 和业务工具 Schema 分离，避免污染工具 handler 和既有幂等记录。
- 旧 checkpoint 恢复时沿用已持久化事件；新 attempt 必须满足新协议。
- 供应商不提供隐藏 reasoning 不影响公开分析，因为内容来自明确的工具输入字段。

## 10. 测试与验收

### 10.1 模型与 Schema

- 每个 provider-facing 工具都要求 `publicAnalysis`。
- 业务工具 Schema 不接受也不接收 `publicAnalysis`。
- `submit_interview_turn.responseText` 保持最后生成约束。
- 隐藏 `reasoning-delta` 仍被忽略。

### 10.2 Runtime

- 增量 `publicAnalysis` 在工具开始前生成公开事件。
- 只收到完整 tool call 时，完整分析仍先于工具事件。
- 多工具调用使用独立前缀，不重复、不串联。
- 缺失、改写、过长或敏感分析进入正确修复路径。
- 最终完整分析先于 `proposal_authorized` 和 `response_started`。
- 工具 handler、授权提案和提交事务中不存在 `publicAnalysis`。

### 10.3 事件与恢复

- PostgreSQL 事件顺序和 SSE 重放保持一致。
- 断线重连不会重复分析文字。
- attempt 丢弃保留公开分析并标记已调整。
- 历史无分析 Run 仍可正常加载。

### 10.4 UI

- 面板使用“分析过程”文案。
- 短分析、工具标签和最终总结按顺序呈现。
- 开始回答时自动折叠，手动展开后可阅读完整记录。
- 无分析事件时显示准确空状态。

### 10.5 完整回归

- Agent、SSE、Repository、Room state 和组件测试通过；
- `npx tsc --noEmit` 通过；
- `pnpm lint` 无新增错误；
- `pnpm build` 通过；
- 真实面试 Run 至少产生一条短分析、一条最终总结和一个正式问题，且不出现隐藏推理内容。

## 11. 成功标准

对于正常开场和回答 Run：

1. 页面不再只显示工具调用标签；
2. 每个工具调用前有模型生成的公开分析；
3. 最终问题前有一段解释证据、缺口与行动选择的完整总结；
4. 刷新和断线重连后内容与顺序不变；
5. 缺失或不安全分析不会被公开；
6. 不增加模型调用、数据库迁移或评分与面试流程变化。
