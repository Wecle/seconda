# Agent Cutover Provider 与失败恢复修复设计

**日期：** 2026-07-14  
**状态：** 已确认，待实施

## 背景

执行 `pnpm agent:cutover` 时，最新 Agent Runtime 已成功创建并 claim 一个 `durable_provisional` Run，但首次模型请求和失败终态提交先后失败：

1. DeepSeek 返回 `400`，原因是请求带有 `response_format: { type: "json_object" }`，而 Agent Prompt 没有声明 JSON 输出。
2. Worker 尝试把 Run 终止为 `aborted_streaming` 时，`terminateRun` 在原始 SQL 表达式中绑定 JavaScript `Date`，`postgres` 驱动无法编码该参数。

失败 Run 仍持久化为 `durable_provisional + running`，lease 已释放，没有提交 assistant 消息或终态事件。现有 cutover 发现逻辑会在修复后重新发现并恢复该 Run，因此不需要手工删除或改写数据。

## 目标

- 结构化 AI 任务继续使用受约束的 JSON 输出。
- Agent 的公开进度文本与工具调用流不使用 JSON response format。
- DeepSeek Agent 调用继续禁用供应商隐藏 thinking。
- 可恢复失败必须原子写入失败状态、退避时间和唯一 `run_failed` 事件。
- 修复后可直接重跑 cutover，并通过第二次运行证明幂等收敛。

## 非目标

- 不改变面试状态机、评分模型、覆盖度规则或问题上限。
- 不改变公开推理、proposal authorization 或消息提交协议。
- 不删除历史 Run、事件或面试数据。
- 不增加新的 Runtime 版本、feature flag 或回滚分支。

## 方案比较

### 方案 A：Provider 显式请求模式（采用）

Provider 创建接口显式接收 `structured` 或 `conversational` 模式。DeepSeek 只在 `structured` 模式下注入 `response_format=json_object`；两种模式都保留现有 endpoint、鉴权、模型解析和 thinking 配置。

优点是共享配置不重复，调用意图可审计，且不会用 Prompt 关键词掩盖协议不匹配。

### 方案 B：拆分两套 Provider 工厂

分别创建 structured provider 和 Agent provider。边界直观，但会复制 endpoint、鉴权、模型 ID 处理及测试，后续容易漂移。

### 方案 C：全局移除 response format

能让 Agent 请求通过，但会削弱简历解析、评分、报告等结构化任务的输出约束，因此不采用。

## 详细设计

### Provider 请求模式

`createProviderModel` 增加必需的请求模式字段：

- `structured`：维持当前结构化适配。DeepSeek 请求包含 `response_format=json_object` 和 `thinking=disabled`；智谱和 OpenAI 保持各自既有结构化行为。
- `conversational`：用于 `streamText + tools`。DeepSeek 请求不包含 `response_format`，仍包含 `thinking=disabled`；其他 Provider 不添加新的请求约束。

所有生产调用点必须显式选择模式：

- `generate-structured`、结构化 AI live contract 使用 `structured`。
- Interview Agent model port 使用 `conversational`。

不提供隐式默认值，避免未来调用点在未选择协议的情况下静默继承错误行为。

### 失败终态退避

`terminateRun` 不再把 JavaScript `Date` 嵌入原始 SQL。PostgreSQL 使用 `CURRENT_TIMESTAMP` 和现有指数退避表达式计算 `next_resume_at`：

- 仅可恢复退出原因写入退避时间。
- 达到最大恢复次数时写入 `NULL`。
- 状态、退出原因、清空 lease、递增事件序列和插入唯一终态事件仍位于同一事务中。
- 现有 lease generation fence 和 advisory lock 保持不变。

采用数据库时间可避免驱动参数编码差异，并保证同一事务中的时间语义一致。

### Cutover 恢复

不对当前失败 Run 做人工修复。重新执行 cutover 时：

1. 发现 `durable_provisional + running` 且无有效 lease 的 Run。
2. 使用现有 attempt/recovery 规则丢弃未确认的 provisional attempt。
3. 重新 claim 并执行最新 Agent 协议。
4. 成功时提交唯一 assistant 消息和唯一终态事件。
5. 再次运行 cutover 时不再恢复已经收敛的 Run。

如果模型仍然失败，修复后的 `terminateRun` 必须把 Run 正常写成可恢复失败状态，而不是抛出第二个数据库异常。

## 测试策略

### Provider 单元测试

- DeepSeek `structured` 请求包含 `response_format=json_object`。
- DeepSeek `conversational` 请求不包含 `response_format`，但包含 `thinking=disabled`。
- Agent model port 明确选择 `conversational`。
- 所有结构化生产调用点明确选择 `structured`。

### PostgreSQL 集成测试

- 对持有有效 lease 的 running Run 执行 `aborted_streaming` 终止。
- 断言状态为 `failed`、lease 已清空、`nextResumeAt` 非空且位于合理退避窗口。
- 断言只写入一个 `run_failed`，sequence 与 Run 一致。
- 重复终止不重复写入终态事件。

### 回归与验收

依次执行：

1. Provider、model port、repository focused tests。
2. 真实 PostgreSQL integration tests。
3. 全量单元测试、TypeScript、lint、production build。
4. `pnpm agent:cutover`。
5. 再次执行 `pnpm agent:cutover`，确认幂等收敛。

## 上线与失败处理

修复不需要数据库 schema 迁移。上线最新代码后运行一次 cutover；命令可安全重跑。

如果 cutover 因外部模型暂时不可用而失败，Run 会留下明确的失败终态和 `next_resume_at`，后续恢复继续使用既有次数上限。任何情况下都不通过删除 Run、事件或面试记录来恢复。
