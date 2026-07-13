# Seconda Agent 实时推理与流式运行架构设计

**日期：** 2026-07-13

**状态：** 已批准

**范围：** 面试 Agent loop、公开推理叙事、工具调用、行动授权、问题流式输出、PostgreSQL 事件传输、恢复与前端状态

**不改变：** 六维评分模型、简历快照语义、题型上限、20 轮上限、面试完成条件

## 1. 背景与问题

当前 Runtime 已具备租约、fencing token、checkpoint、工具幂等、确定性策略、恢复和正式提交事务，但用户可见流式链路不是真正的生成时流式：

1. 模型端能够产生 provisional 工具参数增量。
2. Runtime 只把这些增量暂存在内存。
3. 终结工具完成并提交正式消息后，Runtime 再把完整 `responseText` 按固定字符数切块。
4. SSE 每 750ms 轮询一次数据库，多个伪增量经常在同一次查询中一起到达。
5. 前端在收到提交后的 `response_started` 前一直显示“思考中”，随后整道问题一次性出现。

因此系统表面上有 `text_delta`，实际语义仍是“先完整生成并提交，再模拟流式播放”。这也把两个不同生命周期混在了一起：

- provisional preview：用户正在看到、可能失败或被替换的生成内容；
- authoritative message：通过确定性策略和事务提交的正式面试消息。

本设计将两者彻底分离，同时保留现有生产级恢复能力。

## 2. 目标

- 开始推理后立即流式展示详细的公开推理叙事。
- 公开叙事允许包含疑问、修正、被放弃的方向和最终选择原因。
- 开始输出问题时自动折叠推理区，并真正按模型生成进度展示问题。
- 模型在问题正文开始前提出结构化行动提案，由确定性策略提前授权。
- 正常无工具轮次不固定增加 Renderer 或 Validator 模型调用。
- 工具调用或失败修复按 Agent loop 自然产生额外模型调用。
- PostgreSQL 同时承担持久事件、通知、恢复和幂等事实来源。
- Worker 崩溃、SSE 断线、通知丢失和重复提交都不能产生重复问题。
- 保持 PRD 的简历证据、类别上限、轮次上限和完成条件。

## 3. 非目标

- 不直接展示供应商隐藏 Chain-of-Thought 或隐藏 reasoning token。
- 不展示内部 Prompt、权限信息、工具私密参数或数据库内部标识。
- 不增加 Redis、Kafka 或外部工作流引擎。
- 不保留 V1/V2/V3 Runtime 分支或灰度开关。
- 不固定增加独立的 Planner、Renderer 或 Critic 调用。
- 不改变正式评分流程和六维聚合规则。
- 不增加语音、多用户、分享或认证功能。

“公开推理叙事”是专门提示模型生成、可以面向用户展示的推理记录。它可以保留草稿感和自我修正，但不是供应商不可控的隐藏推理通道。

## 4. 核心决策

### 4.1 单一 Agent loop

一次 Run 由一个 Agent loop 推进：

```text
公开推理
  -> 可选只读工具调用
  -> 工具结果回灌
  -> 继续公开推理
  -> 结构化终结提案
  -> 提案前置授权
  -> 问题正文流式输出
  -> 最终校验与原子提交
```

无工具且一次通过时只需要一次模型调用。调用工具后，工具结果必须作为新消息回灌模型，因此自然产生下一次模型调用。提案或措辞失败时才产生修复调用。

### 4.2 轻量评估并入终结提案

当前独立的轻量评估模型调用取消。模型在终结提案中同时提出：

- `AnswerAssessment`；
- 覆盖度变化；
- 下一步动作；
- 简历证据；
- 问题意图或完成原因；
- 最终候选人可见文本。

失败 attempt 可以重新生成，但同一候选人回答只能提交一份正式轻量评估。正式六维评分仍只在面试结束后运行。

### 4.3 分析阶段工具只读

模型可见的分析工具只允许读取：

- 当前简历快照与证据；
- 已提交问答历史；
- 类别计数和覆盖度；
- 最近轻量评估；
- 当前目标岗位与面试配置。

模型不得在分析中途直接更新覆盖度、创建问题、增加轮次或结束面试。所有领域写入集中到最终事务。

### 4.4 提案前置授权，问题乐观流式

模型必须先生成可授权字段，再生成 `responseText`。Runtime 在 `responseText` 开始前完成确定性授权。授权通过后，问题正文可以立即作为 provisional preview 流向 UI；生成完成后再执行最终措辞校验和事务提交。

这解决了三个目标之间的冲突：

- 不等待完整问题后才开始显示；
- 大部分非法问题在 UI 看见正文前被拦截；
- 不固定增加第二次模型调用。

自然语言完整语义只能在生成后完全验证，因此仍保留极低概率的 `response_discarded` 与修复路径。

## 5. Runtime 状态机

```text
accepted
  -> reasoning
       -> tool_running -> reasoning        可重复
       -> proposal_streaming
            -> authorized -> responding
            -> repairing -> reasoning
  -> responding
       -> validating
            -> committing -> completed
            -> repairing -> reasoning
  -> failed                                  重试预算耗尽
```

状态含义：

| 状态 | 含义 |
| --- | --- |
| `accepted` | 用户消息和 durable trigger 已提交，Run 等待 Worker |
| `reasoning` | 模型输出公开推理或决定调用工具 |
| `tool_running` | Runtime 校验并执行只读工具 |
| `proposal_streaming` | 终结工具参数正在生成，问题正文尚未开放 |
| `authorized` | 提案前缀通过确定性策略并冻结 hash |
| `responding` | 问题或结束语正在 provisional 流式展示 |
| `validating` | 模型输出结束，执行最终措辞和状态校验 |
| `committing` | 领域状态、正式消息和提交事件正在原子写入 |
| `repairing` | 当前 attempt 失效，准备有界修复 |
| `completed` / `failed` | Run 终态 |

每个 Run 使用现有租约和 fencing generation。所有事件写入、checkpoint 和领域提交都必须携带当前 fencing token。

## 6. 模型输出协议

### 6.1 公开推理

模型在普通 assistant text block 中输出公开推理。Runtime 将这些文本解释为 `reasoning_delta`，而不是正式面试消息。

公开推理可以包含：

- 对回答证据和缺口的分析；
- 对术语错误或歧义的判断；
- 考虑过的追问方向；
- 放弃某个方向的原因；
- 信息增益和覆盖度判断；
- 下一步选择理由。

供应商隐藏 thinking block 不直接进入公开事件。候选人回答、简历和工具结果都视为不可信输入，不能改变输出协议或要求泄露内部 Prompt。

### 6.2 只读工具

工具调用必须使用结构化 `tool_call`。Runtime 负责：

1. 校验工具名称和参数 Schema；
2. 校验工具属于当前允许集合；
3. 校验 run、interview 和 snapshot 边界；
4. 执行只读查询；
5. 持久化幂等工具结果和 checkpoint；
6. 将 `tool_result` 回灌模型。

工具生命周期可以产生经过净化的公开事件，例如“正在核对简历项目经历”，但不能展示原始 SQL、内部 ID 或完整工具参数。

### 6.3 终结提案

最终使用一个终结工具，例如 `submit_interview_turn`。输入采用可提前授权的前缀，`responseText` 必须最后生成：

```ts
type InterviewTurnProposal = {
  assessment: AnswerAssessment | null;
  coverageChanges: CoverageChange[];
  decision:
    | {
        action: "ask" | "clarify";
        category: QuestionCategory;
        intent: "new_topic" | "follow_up" | "verify_evidence";
        evidenceIds: string[];
        coverageTarget: string;
        estimatedInformationGain: "low" | "medium" | "high";
      }
    | {
        action: "finish";
        completionReason:
          | "user_requested"
          | "max_rounds"
          | "coverage_sufficient"
          | "low_information_gain";
      };
  responseText: string;
};
```

Opening Run 的 `assessment` 可以为 `null`。回答后的 Run 必须携带轻量评估。

Runtime 按 partial tool args 解析前缀。当 `assessment`、`coverageChanges` 和 `decision` 完整时：

1. 执行 Schema 校验；
2. 从数据库读取最新权威状态；
3. 执行确定性应用策略；
4. 生成规范化提案和 `proposalHash`；
5. 持久化授权 checkpoint；
6. 允许随后产生的 `responseText` 增量进入公开流。

如果 `responseText` 在前缀完整且授权前出现，本 attempt 违反协议。Runtime 可以短暂缓冲，但不得在完整生成后将其突发释放来伪装流式；该 attempt 必须中止并进入修复。

最终完整参数中的前缀必须与 `proposalHash` 一致。模型若在后续修改已授权字段，提交失败。

## 7. 校验模型

### 7.1 提案结构校验

- 所有枚举、数组和字符串满足严格 Schema 与长度上限；
- evidence ID 属于当前不可变简历快照；
- 追问或澄清包含一个明确意图；
- finish 包含允许的完成原因；
- `responseText` 位于协议末尾；
- 最终提案前缀与已授权 hash 一致。

### 7.2 确定性应用策略

授权和最终提交事务内各检查一次：

- 每类别最多 3 题；
- 最多 20 个候选人回答轮次；
- Opening 不允许模型自行结束；
- Agent 主动完成至少 6 轮并触达至少 3 类；
- `coverage_sufficient` 的所有已触达类别均为 `sufficient` 或 `exhausted`；
- `low_information_gain` 的预计提交后最近两次评估均无需追问；
- `user_requested` 和 `max_rounds` 有持久状态证明；
- 问题和证据属于面试简历快照；
- 动作属于当前允许动作集合。

授权阶段使用“当前已提交状态 + 本轮提案”的 projected state：本轮 `assessment` 参与最近两次轻量评估判断，本轮规范化后的 `coverageChanges` 参与覆盖充分性判断。最终事务锁定最新状态后重新构造 projected state 并再次验证，避免因为评估与行动合并而延迟一轮，也避免授权与提交之间的竞态。

### 7.3 增量措辞校验

问题流式生成时检查：

- 配置语言是否明显偏离；
- 长度上限；
- 协议控制标记；
- 额外问题；
- 未授权的新专有名词、公司、项目或数字；
- 面试过程中出现正式六维分数。

Runtime 保留小型尾部缓冲，以便在确定性错误到达 UI 前停止。

### 7.4 最终措辞校验

- ask/clarify 只包含一个主要问题；
- finish 只包含结束语，不提出新问题；
- 文本与已授权 intent 和 persona 一致；
- 事实落在授权 evidence IDs；
- 公开推理或协议内容没有混入正式回复。

确定性校验始终执行。只有高风险歧义或校验失败才触发模型复核或修复，不固定调用 Validator。

## 8. 事件协议

### 8.1 事件信封

```ts
type AgentEvent = {
  id: string;
  runId: string;
  sequence: number;
  attemptId: string | null;
  logicalMessageId: string | null;
  type: AgentEventType;
  visibility: "public" | "internal";
  payload: unknown;
  createdAt: string;
};
```

`(runId, sequence)` 严格递增且唯一。事件只追加，不原地更新。`logicalMessageId` 对应现有 `provisional_message_id`，修复 attempt 不更换。

### 8.2 正常公开事件顺序

```text
run_started
phase_changed(reasoning)
reasoning_started
reasoning_delta...
tool_started? / tool_completed?
reasoning_delta...
proposal_authorized
reasoning_completed
response_started
response_delta...
response_finished
message_committed
run_completed
```

语义约束：

- `response_started` 必须在 `proposal_authorized` 之后；
- `response_delta` 必须是模型仍在生成时产生的真实增量；
- `response_finished` 只表示模型输出结束；
- `message_committed` 才代表正式业务提交；
- `run_completed` 是 Run 终态。

### 8.3 修复事件

提案授权前失败：

```text
attempt_discarded
attempt_started(attempt + 1)
reasoning_delta...
```

问题已经展示后失败：

```text
response_discarded
attempt_started(attempt + 1)
reasoning_delta...
response_started
response_delta...
message_committed
```

旧 attempt 的公开推理可以保留，并用“已调整方案”标识。旧 provisional 问题不能进入正式 transcript。

## 9. PostgreSQL 实时传输

### 9.1 Durable event first

公开推理和问题增量先写 `interview_agent_events`，事务提交后再唤醒 SSE。Worker 内存只负责很短时间的合并，不是事实来源。

满足任一条件就 flush：

- 距离上次 flush 约 100ms；
- 缓冲达到约 32–64 个字符；
- 遇到问号、句号、换行等自然边界；
- 流结束、丢弃或即将提交。

不得每 token 写一次 PostgreSQL，也不得在完整消息提交后按固定 12 字切块。

### 9.2 LISTEN/NOTIFY

事件事务内调用 `pg_notify`，通知在事务提交后交付。payload 仅包含：

```json
{ "runId": "...", "latestSequence": 42 }
```

每个 Node 服务进程维护一条专用监听连接和一个进程内 `PostgresWakeHub`。WakeHub 只分发唤醒，不保存业务状态。SSE 被唤醒后执行：

```sql
SELECT ...
FROM interview_agent_events
WHERE run_id = $1 AND sequence > $2
ORDER BY sequence;
```

保留 1–2 秒低频兜底查询，覆盖通知丢失、监听重连、多实例和冷启动。通知正常时不执行固定 750ms 高频轮询。

### 9.3 SSE 恢复

- SSE `id` 使用事件 sequence；
- 服务端取 `Last-Event-ID` 与显式 cursor 的较大值；
- 建连后先补发数据库事件，再进入监听；
- 重复事件由 `(runId, sequence)` 去重；
- terminal event 发送后关闭连接；
- 无 cursor 时先加载 committed room snapshot，再恢复当前 attempt 的 provisional 事件。

## 10. 前端状态与交互

```ts
type LiveTurnState = {
  logicalMessageId: string;
  attempt: number;
  phase: "reasoning" | "responding" | "committing";
  reasoningEntries: ReasoningEntry[];
  provisionalResponse: string;
  committedMessageId?: string;
  lastSequence: number;
  userCollapsedReasoning: boolean;
};
```

交互规则：

1. 收到 `reasoning_started` 时默认展开推理区。
2. 用户在推理期间手动折叠后保持折叠，不因新 delta 强制展开。
3. 收到 `response_started` 时自动折叠，并立即开始展示问题。
4. 用户可随时再次展开查看完整推理和工具进度。
5. 刷新时若仍在 reasoning 阶段则默认展开；已经 responding 或 committed 则默认折叠。
6. `response_discarded` 清空 provisional 问题，但保留推理和修正历史。
7. `message_committed` 使用权威数据库消息无闪烁替换 provisional 内容。
8. reducer 按 event sequence 和 logical message ID 去重，重连不能重复消息。

## 11. 提交事务与幂等性

最终事务必须原子完成：

- 再次锁定并验证 interview 和 run；
- 再次执行题型、轮次、完成条件和 proposal hash 校验；
- 写入唯一轻量评估及其证据；
- 应用覆盖度变化；
- 创建问题和正式 assistant message，或创建结束语并进入 scoring；
- 增加题型计数和相应领域状态；
- 写入终结工具幂等结果；
- 写入 `message_committed` 事件。

完成动作还需在同一事务中幂等创建 completion job。正式消息、评估和覆盖度不能部分成功。

幂等键：

- run：现有 `(interview_id, idempotency_key)`；
- event：`(run_id, sequence)` 与 `(run_id, dedupe_key)`；
- tool：`(run_id, tool_call_id)`；
- message：稳定 `provisional_message_id` 与现有 message idempotency；
- assessment：候选人 answer message ID 唯一；
- completion job：interview ID 唯一。

## 12. Checkpoint 与故障恢复

以下边界必须持久化 checkpoint：

- Run 已接受并取得租约；
- 每次工具结果已回灌上下文；
- 提案已授权及 `proposalHash`；
- provisional 流最新事件序号；
- attempt 被丢弃；
- 最终提交完成。

供应商 HTTP 流无法续传。恢复策略：

| 崩溃位置 | 恢复方式 |
| --- | --- |
| 未展示推理 | 从 durable trigger 重试 |
| 已展示推理、未授权 | 保留推理，丢弃 attempt，重新规划 |
| 工具完成后 | 使用幂等 tool result 回灌，不重复副作用 |
| 已授权、未展示问题 | 使用授权提案开始定向修复 |
| 问题已部分展示 | 发送 `response_discarded`，再定向修复 |
| 提交成功、通知前崩溃 | SSE 从数据库读到 committed event |
| 提交结果不确定 | 先按幂等键读取，不盲目重写 |
| 租约被接管 | stale Worker 的所有写入被 fencing 拒绝 |

自动重试沿用有界 AttemptController。任何已经接受 provisional 内容的 attempt 若要重试，必须先明确 discard，绝不把新输出拼到旧缓冲。

## 13. 数据模型变化

复用现有表并做增量扩展：

```text
interview_agent_runs
  + phase
  + authorized_proposal_json
  + authorized_proposal_hash
  + proposal_authorized_at
  + response_started_at

interview_agent_events
  + attempt_id
  + logical_message_id
  + visibility
```

现有字段继续承担：

- `attempt_id` / `attempt_number`：当前 attempt；
- `provisional_message_id`：稳定 logical message ID；
- `last_event_sequence`：事件游标；
- `checkpoint_json`：可恢复 Agent 上下文；
- `lease_owner` / `lease_generation`：fencing；
- `interview_agent_tool_commits`：工具幂等；
- `interview_messages.run_id`：正式消息归属。

`visibility` 默认 `internal`，只有显式标记为 `public` 的事件进入 SSE，防止新增内部事件被意外暴露。

## 14. 直接迁移策略

不保留旧 Runtime 分支：

1. 先更新 PRD §7、§8.0 和 §13；
2. 执行向前兼容 PostgreSQL migration；
3. 对正在运行的 run 递增 fencing generation 并清除旧租约；
4. 已有正式 `interview_messages` 的 run 按数据库事实收敛为完成；
5. 未提交正式消息的旧 provisional attempt 标记 discarded；
6. 从已提交消息、简历快照、覆盖度和 durable trigger 重建最新 checkpoint；
7. 最新 Worker 直接按本设计继续，不加载旧执行器。

历史正式面试数据和简历快照不改变。旧 provisional 事件不是正式 transcript，可以保留为内部审计或标记失效，但不能重新展示为当前问题。

## 15. 可观测性

每个 Run 记录：

- answer accepted 到首个 `reasoning_delta`；
- reasoning duration；
- model call 和 tool call 次数及耗时；
- proposal authorization duration 与拒绝原因；
- authorization 到首个 `response_delta`；
- delta flush 间隔和批次大小；
- 最后 delta 到 `message_committed`；
- attempt、repair、discard 次数；
- SSE reconnect 与 fallback query 次数；
- lease takeover 与 stale write 拒绝次数；
- token 和 cache telemetry。

关键质量信号：

- `response_delta` 必须发生在 `message_committed` 之前；
- 未授权提案不能产生 `response_started`；
- 正常无工具轮次不固定增加额外模型调用；
- `response_discarded` 比例持续监控；
- PostgreSQL 通知健康时不进行 750ms 高频轮询。

## 16. 测试策略

### 16.1 单元与属性测试

- partial tool JSON 在任意 chunk 边界下可解析；
- `responseText` 提前出现时中止协议；
- 授权字段发生变化时 hash 校验失败；
- coalescer 的时间、长度、标点和最终 flush；
- public/internal 事件隔离；
- UI reducer 的展开、自动折叠、discard、重连和去重；
- 所有 PRD 确定性策略规则。

### 16.2 PostgreSQL 集成测试

- 事件序号、dedupe 和 NOTIFY 顺序；
- 通知丢失后的游标补发；
- 评估、覆盖度、消息和提交事件原子性；
- fencing takeover 后 stale Worker 全部写入失败；
- 同一 logical message 只能提交一次；
- 提交成功但连接断开后读取既有结果。

### 16.3 故障注入

在工具执行、提案授权、首个 delta、最后 delta、正式提交、通知和 checkpoint 的前后分别强制崩溃，验证恢复结果和事件顺序。

### 16.4 端到端测试

1. 候选人消息先显示；
2. 推理区自动展开并实时增长；
3. 工具进度只显示净化描述；
4. `response_started` 时推理区自动折叠；
5. 问题在模型生成期间逐段出现；
6. 刷新后从 cursor 继续且无重复；
7. discard 后旧问题消失、修复问题正常提交；
8. 完成面试只创建一次评分任务。

CI 使用可控 FakeModelPort 模拟 chunk、工具、断流和协议错误。真实供应商只运行可选 smoke test，避免每次 CI 产生费用和不稳定性。

## 17. 验收标准

- 删除提交后固定字符切块的伪流式实现。
- 第一段问题文本在正式提交前到达 UI。
- 推理开始默认展开，问题开始自动折叠。
- 问题正文在提案授权前绝不对用户可见。
- 正常无工具轮次没有固定 Renderer/Validator 调用。
- 工具调用严格遵循结构化调用、权限校验、结果回灌的 Agent loop。
- provisional 与 committed 内容在数据库、SSE 和 UI 三层均明确区分。
- PostgreSQL `LISTEN/NOTIFY` 为主唤醒，低频 polling 只做兜底。
- 所有崩溃边界均不产生重复问题、重复评估或重复完成任务。
- `pnpm lint`、`npx tsc --noEmit`、相关单元/集成/E2E 测试全部通过。

## 18. 与既有设计的关系

本设计替代或修订以下既有结论：

- `2026-07-12-agent-assessment-streaming-ux-design.md` 中“轻量评估固定在 Agent loop 前独立执行”的结论；
- 既有“只展示简短公开摘要”的思考 UI；
- 提交完整消息后再合成 `text_delta` 的实现；
- SSE 固定 750ms polling 作为主要交付机制。

保留以下既有能力：租约、fencing、checkpoint、上下文压缩、模型路由、工具幂等、确定性应用策略、评分 completion job 和正式六维评分。

## 19. 参考实现原则

- Claude Code 分析快照展示了模型流、结构化工具调用、工具结果回灌和失败后丢弃孤立 partial 状态的循环；该仓库是第三方分析，不是 Anthropic 官方源码：<https://github.com/liuup/claude-code-analysis/tree/7b7b915d7da804088a8152ed24c68e3da2d1110e>
- OpenClaw 将 assistant、thinking、tool 和 lifecycle 作为独立事件，并在 Gateway 合并、节流和最终 flush 增量：<https://github.com/openclaw/openclaw/tree/a965d28e040949dba215bbb0d4a40ef47d63cc36>
- Anthropic 的托管 Agent 文档将 best-effort preview 与 authoritative buffered message 分离：<https://platform.claude.com/docs/en/managed-agents/events-and-streaming>

Seconda 借鉴这些事件和循环边界，但额外保留面试领域所需的提案前置授权与最终确定性事务校验。
