# Agent Turn Presentation, Grounding, and Polling Design

## Goal

修复 Agent 面试房间的四类问题：Run 级内容与消息错位、思考未结束便展示问题、提问包含无来源事实，以及面试结束后无限轮询详情接口。

## Turn Lifecycle

每一轮使用严格的四阶段协议：

1. `thinking`：完成回答轻量评估、简历证据读取、覆盖度更新和下一步规划。只允许发送安全的公开思考摘要。
2. `ready_to_respond`：下一步行动已经通过参数、业务规则、简历证据和事实声明校验。服务端发送 `response_started`。
3. `responding`：仅在 `response_started` 之后发送候选人可见的 `text_delta`，流式展示 AI 输出。
4. `committed`：AI 消息完成持久化并发送 `message_committed`，本轮结束。

前端不得用收到首个文本片段来推断思考已经结束；阶段转换必须来自显式事件。断线重放必须保持相同顺序。

## Per-turn Timeline

房间状态从全局的 `thinking`、`artifacts` 和 `provisional` 改为按 Run 组织的时间线节点：

```text
candidate message
turn(runId)
  ├─ thinking panel
  ├─ committed artifact cards
  └─ assistant message (provisional → committed)
```

思考面板和背景卡片始终位于它们对应的 AI 消息上方，而不是统一追加到整个消息列表末尾。每个节点通过 `runId`、稳定 `artifactId` 和最终 `messageId` 对齐。刷新页面时，服务端返回 Run、事件和消息关联，重建相同顺序并按稳定 ID 去重。

思考面板在 `thinking` 阶段自动展开；收到 `response_started` 后保持在消息上方并自动折叠。用户可以手动展开；Run 失败时保持展开且清除 provisional 文本。

## Candidate-visible Response Shape

追问型输出必须是“承接 + 追问”，而非孤立问题：

1. 用 1–3 句评价候选人刚才回答中已经确认的内容。
2. 指出一个回答中的优势、缺口、含糊点或值得深入的证据。
3. 自然引出且只引出一个问题。

示例结构：

```text
你对查询键分层和失效策略的说明比较清楚，也解释了如何避免旧请求覆盖新状态。
不过目前还缺少异常回滚失败时的处理细节。请具体说明一次回滚失败的场景，以及你如何保证最终一致性？
```

评价不得包含六维正式评分，不得进行人格判断，不得泄露内部工具或原始模型推理。

## Evidence Grounding

问题生成采用两层约束：

### Prompt constraint

模型只能将以下内容表述为已知事实：

- 简历证据片段中的明确陈述；
- 候选人在已提交回答中的明确陈述；
- 系统持久化的结构化配置。

推断、常见行业情况或缺失信息必须改写为询问或条件句。

### Deterministic fact-claim guard

在进入 `ready_to_respond` 前，对候选人可见文本执行事实声明校验。重点检查：

- 人数、年限、金额、百分比和性能数字；
- 公司、项目、职位和团队关系；
- 技术栈、职责、成果与时间范围；
- “你提到”“你的简历显示”“你负责”等确定性归因表达。

每个事实声明必须关联已加载的简历证据 ID 或候选人消息 ID，并且对应原文能够支持该声明。无法证明时返回可修复的工具错误，要求模型删除声明或改为询问式表达。例如把“你提到团队有四人”改成“这个项目的团队规模和你的职责分别是什么？”。

## Streaming Contract

新增公开事件：

- `response_started`: `{ runId, messageId }`
- `text_delta`: 增加 `runId`，只允许在对应 `response_started` 之后出现。
- `message_committed`: 增加 `runId`，用于将 provisional 消息原位升级为正式消息。

问题文本的流式输出发生在所有规划工具和事实校验成功之后。为支持这一顺序，规划结果与候选人可见措辞分离：Agent 先提交经过校验的行动草案，再由响应阶段生成并流式展示“承接 + 追问”。

## Completion Polling

详情轮询改为有界退避控制器：

- 间隔依次为 1.5 秒、3 秒、5 秒、10 秒，之后维持 10 秒；
- 总等待上限 2 分钟；
- `completed` 或 `failed` 后立即停止；
- 页面不可见或离线时暂停，恢复可见/联网后继续；
- 同一时间最多一个详情请求；
- 超过上限后停止自动请求，显示“手动刷新”与“恢复任务”；
- 组件卸载和路由跳转必须取消计时器与在途请求。

报告页和面试房间共用同一纯轮询策略，避免两套行为漂移。

## Failure Handling

- `thinking` 失败：保持面板展开，不展示任何问题草稿。
- `responding` 失败：清除未提交文本；已提交消息不受影响。
- 事实校验失败：不进入响应阶段，允许 Agent 在有界回合内修复；重复失败由现有 Loop 保险丝终止。
- Completion Job 失败：停止自动轮询并显示显式恢复按钮。

## Testing

自动化测试覆盖：

- 每个 Run 的 thinking、artifact 和 assistant message 顺序及刷新重建；
- `text_delta` 在 `response_started` 前被服务端拒绝或前端忽略；
- 思考在响应开始后折叠，失败时保持展开；
- 数字、团队人数和技术栈等无来源声明被拒绝并改写为问题；
- “承接 + 单一追问”响应契约；
- 轮询退避、单飞、隐藏页暂停、终态停止和 2 分钟熔断；
- SSE 断线重放仍保持阶段顺序且不重复卡片或消息。

## Acceptance Criteria

- 思考过程和背景卡片位于对应 AI 消息上方。
- AI 只在思考与校验结束后开始流式输出。
- 追问前包含简短、基于证据的分析或评价，并且一次只问一个问题。
- 面试官不会把简历和回答中不存在的信息表述为事实。
- 面试结束后详情请求采用有界退避，并在终态、失败、隐藏或超时条件下停止。
- 不向浏览器暴露原始 chain-of-thought、隐藏工具参数或内部 Prompt。
