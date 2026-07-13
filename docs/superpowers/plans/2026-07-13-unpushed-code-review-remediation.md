# 未推送 Interview Agent 代码审查与修复交接

> 状态：待修复，阻断合并/推送
>
> 审查日期：2026-07-13
>
> 审查范围：`29a7f24405a1dffe2d6be70f6a96843102e8cf38..ce161f9027eb49f1c1b4fdc504adbc851817e35b`
>
> 规模：82 个本地提交，140 个文件，约 14,824 行新增、358 行删除

## 新对话启动指令

将下面内容原样发送到新的 Codex 对话：

```text
请执行 docs/superpowers/plans/2026-07-13-unpushed-code-review-remediation.md 中的修复计划。

开始前必须完整阅读：
1. 仓库 AGENTS.md
2. /Users/wecle/Desktop/Work/Flash/PRD/Seconda PRD.md
3. 本修复交接文档
4. docs/superpowers/specs 和 docs/superpowers/plans 中与 Interview Agent、恢复、SSE、评分相关的文档

先核对当前分支和工作区，保留用户已有改动，不推送代码。按文档的阶段顺序实施；每阶段完成后运行该阶段测试并报告结果。评分权重、分数精度、简历快照语义若在 PRD 中不明确，先更新/确认 PRD 再修改实现，不要自行改变评分模型或面试流程。
```

## 1. 审查结论

当前实现的类型检查、单元测试和生产构建均通过，但 Agent Run 的持久化恢复、租约接管、结束竞态和完成任务状态机仍存在高风险一致性问题。在进程崩溃、网络失败、租约过期或重复请求下，可能出现：

- 候选人答案已入库，但对应 Run 永久失败且无法从 UI 恢复；
- 同一个 Run 生成重复问题、重复消息或重复完成任务；
- 失去租约的旧 Worker 覆盖新 Worker 的结果；
- 用户结束面试后，正在运行的 Worker 仍提交新问题；
- 分类题数上限被绕过，超过 PRD 的每类 3 题限制；
- 活跃面试被直接推进到评分；
- 重试导致无界 AI 调用和费用放大；
- 每题总分不满足“六维加权平均”的 PRD 约束；
- 删除简历版本级联删除历史面试，违反简历快照要求。

这些问题在正常单进程 happy path 中不容易暴露，但会直接影响面试记录完整性、恢复能力、成本控制和报告可信度。建议在推送前至少完成 P0/P1 项，并补充真实 PostgreSQL 并发与崩溃恢复测试。

## 2. 修复边界与不可变约束

修复时必须遵守以下约束：

1. 不新增 PRD 范围之外的产品功能，不实现认证、云存储、语音或多人分享。
2. 不在未更新 PRD 的情况下改变评分模型、评分权重、面试流程或完成条件。
3. 每个问题分类最多 3 题，追问计入该分类。
4. 候选人回答轮次最多 20 轮，用户可随时请求结束。
5. 正式六维评分只能在面试完成后执行；面试中只允许轻量决策评估。
6. 模型只提出下一步动作，确定性应用策略负责授权。
7. 问题必须基于简历内容，不得虚构候选人经历。
8. 所有恢复和重试必须幂等，不能增加回答轮次、重复写消息或重复计费。
9. 修复期间保留用户现有工作区改动，不重置、不覆盖、不自动推送。

## 3. 问题总览

| ID | 优先级 | 问题 | 主要风险 |
|---|---|---|---|
| R-01 | P0 | 答案已接收后 Run 失败无法恢复 | 面试永久卡死 |
| R-02 | P0 | Checkpoint 只写不读，恢复从头执行 | 重复问题、消息和完成任务 |
| R-03 | P0 | 租约无 fencing token | 旧 Worker 覆盖新 Worker |
| R-04 | P0 | 用户结束与在途 Run 存在竞态 | 结束后仍产生新问题 |
| R-05 | P0 | 问题、覆盖度和消息非原子提交 | 隐形问题、配额错乱 |
| R-06 | P1 | 分类计数可被 topic 行覆盖 | 每类最多 3 题失效 |
| R-07 | P1 | completion/resume 绕过状态机 | 活跃面试被提前评分 |
| R-08 | P1 | 后台执行依赖首次 `after()` | 进程退出后任务永久 pending |
| R-09 | P1 | 提交答案网络异常锁死 UI | 无法按原幂等键重试 |
| R-10 | P1 | `finish_interview` 无确定性授权 | 模型可越权提前结束 |
| R-11 | P1 | Completion 未端到端传播取消/租约 | 租约丢失后仍消耗 AI 并写入 |
| R-12 | P1 | 半完成幂等请求不能自愈 | Run 存在但永远不执行 |
| R-13 | P1 | 总分由模型直接生成且仅整数 | 违反六维加权平均要求 |
| R-14 | P1 | 未实现 InterviewResumeSnapshot | 删除简历会破坏历史面试 |
| R-15 | P1 | 完成任务重试预算无上限 | 成本型 DoS |
| R-16 | P2 | clarify 被错误要求证据 | 合法澄清动作被拒绝 |
| R-17 | P2 | `targetRole` 只读不写 | 角色推断无法成为持久状态 |
| R-18 | P2 | 语言/Persona 缺少强系统约束 | 输出可能不服从配置 |
| R-19 | P2 | 文档尾随空格导致 diff-check 失败 | 合并质量门禁失败 |

## 4. 详细问题与修复要求

### R-01：答案已接收后 Run 失败无法恢复

证据：

- `lib/interview/agent/drizzle-store.ts:65`：`acceptCandidateMessage` 在 Run 执行前提交答案、增加轮次并把问题标记为已回答。
- `lib/interview/agent/worker.ts:114`：失败 Run 的恢复判定返回 `failed`，不会重新调度。
- `components/interview/agent-interview-room.tsx:106`：`run_failed` 只展示错误，没有重试入口。

失败场景：答案已经成为不可变事实，但后续 Agent 执行失败。用户再次提交相同答案时，服务端找不到未回答问题并返回 500；旧 Run 又不会恢复，面试永久卡住。

修复要求：

- 将“答案接收”和“基于该答案继续 Run”视为可独立恢复的两个持久步骤。
- 为失败 Run 提供幂等恢复，复用原始答案、assessment 和 idempotency key。
- 恢复不得再次增加轮次、改写答案或创建新的候选人消息。
- UI 明确区分“答案发送失败”和“答案已接收、Agent 执行失败”，后者重试 Run 而不是重发答案。

### R-02：Checkpoint 只写不读，恢复从头执行

证据：

- `lib/interview/agent/worker.ts:50`：执行器只收到 trigger，没有使用持久化 checkpoint。
- `lib/interview/agent/runtime.ts:44`：每次执行重新把消息、计数器和 phase 初始化为零值。
- `lib/interview/agent/runtime.ts:309`：终端工具完成提交后才保存 checkpoint 并终止 Run。

如果进程在数据库业务提交后、Run 终止前崩溃，恢复会从 trigger 开始重新调用模型和工具，从而重复提交问题、覆盖度、消息、结束动作或 completion job。

修复要求：

- 恢复 checkpoint 中的 phase、步骤计数、消息/工具进度、激活技能和终端提交状态。
- 所有终端工具按 `(runId, toolCallId)` 或等价稳定键实现幂等。
- 明确定义“业务结果已提交但 Run 尚未终止”的恢复路径：只补齐 Run 终止和事件，不再次执行业务提交。
- 为每个崩溃点建立测试：业务提交前、业务提交后、checkpoint 后、terminate 前。

### R-03：租约缺少 fencing token

证据：

- `lib/interview/agent/worker.ts:60`：旧 Worker 丢失租约后，只要 Run 仍是 running 就可能调用 terminate。
- `lib/interview/agent/repository.ts:336`：`appendEvent` 未校验 lease owner/status。
- `lib/interview/agent/repository.ts:513`：`saveCheckpoint` 未校验 lease owner。
- `lib/interview/agent/repository.ts:520`：`terminateRun` 只校验状态，不校验 owner 或租约代次。

Worker A 租约过期、Worker B 接管后，A 仍可能追加事件、保存 checkpoint 或终止 B 正在执行的 Run。

修复要求：

- 领取租约时产生单调递增的 lease generation/fencing token。
- 所有事件、checkpoint、工具业务提交和终止写入必须携带并校验 owner + generation。
- 数据库更新条件必须原子包含 `status = running`、owner 和 generation。
- 旧 Worker 收到零行更新后只能停止，不得把 Run 标记为失败或覆盖新 Worker 状态。

### R-04：用户结束面试与在途 Run 存在竞态

证据：

- `lib/interview/agent/drizzle-store.ts:117`：`markCompleting` 只更新 interview 状态。
- `lib/interview/agent/composition.ts:201`：提交问题的事务未重新校验 interview 是否仍 active，也未校验租约代次。

用户点击结束后，已经运行中的 Agent 仍可提交一个新问题，然后 completion/scoring 同时开始，造成状态和报告数据不一致。

修复要求：

- 用户结束、Agent 终端提交和 completion 状态转换使用同一套锁/版本条件。
- 终端工具提交时再次校验 interview 仍为允许该动作的状态。
- 用户结束时使活跃 Run 失效或取消，并通过 fencing 阻止其后续写入。
- 结束后只允许约定的 closing 消息，不允许新问题或候选回答轮次。

### R-05：问题、覆盖度和 assistant 消息非原子提交

证据：

- `lib/interview/agent/composition.ts:201`：问题和 coverage 在一个事务中写入。
- `lib/interview/agent/composition.ts:226`：assistant message 在另一个事务中追加。

两次事务之间失败会产生用户看不见的未回答问题，同时消耗题目分类配额。恢复时还可能再创建一个问题。

修复要求：

- 在单个数据库事务中完成 question、category/topic coverage、assistant message、消息序号和幂等胜者写入。
- assistant message 应关联 `questionId`，便于恢复和审计。
- 若当前 repository 接口无法共享事务，扩展 transaction context，而不是用补偿式 best effort。

### R-06：分类最多 3 题的规则可被覆盖度行绕过

证据：

- `lib/interview/agent/composition.ts:185`：`update_coverage` 会为同一 category 创建多个 topic 行，默认 `questionCount = 0`。
- `lib/interview/agent/repository.ts:496`：读取所有 coverage 后用 category 作为 `Object.fromEntries` key；topic 行可能不确定地覆盖 `__category__` 计数行。

修复要求：

- 分类计数只读取 `topic = '__category__'` 的规范行，或在 SQL 中显式聚合。
- 在创建问题的同一事务内对分类计数加锁并检查上限。
- 数据库层尽可能增加唯一约束/条件，防止并发请求共同插入第 4 题。
- 测试普通问题、追问、并发请求和恢复重放均不能突破 3 题。

### R-07：completion/resume 绕过面试状态机

证据：

- `app/api/interviews/[id]/completion/resume/route.ts:13`：只检查所有权，不检查 configVersion 或 interview 状态；没有 job 时会直接创建。
- `lib/interview/completion/composition.ts:14`：执行器接受 active 和 failed 状态。

面试所有者可直接调用端点，把仍在进行中的 v1/v2 面试推进到评分。

修复要求：

- resume 仅允许 Agent v2 且状态为 `completing/scoring/reporting/failed` 的面试。
- 正常 resume 应要求已经存在由合法 finish/user-end 流程创建的 completion job。
- executor 不得把 active 作为正常可评分状态。
- 若保留人工修复入口，应单独命名、鉴权并留下审计记录，不与用户端 resume 混用。

### R-08：后台恢复仍依赖首次 `after()` 回调

证据：

- `components/interview/agent-interview-room.tsx:62`：completion 轮询仅刷新 GET 状态。
- `app/(app)/interviews/[interviewId]/report/page.tsx:263`：报告页同样只轮询状态。
- `components/interview/use-agent-run-stream.ts:99`：SSE 异常后只查询状态并重连，没有请求 Run resume。

若进程在响应后、`after()` 执行前退出，pending completion job 或未领取 Run 不会被任何后续轮询真正执行。

修复要求：

- GET 状态返回可判断的 pending/unleased/stale 信息。
- 客户端在超时后调用幂等 resume 一次，或由可靠后台调度器主动扫描恢复。
- 避免每次轮询都触发 AI；需有退避、领取锁和单飞控制。
- 增加“首次 after 从未执行”的端到端恢复测试。

### R-09：答案提交网络异常会锁死 UI，且没有同键重试

证据：

- `components/interview/agent-interview-room.tsx:135`：提交 fetch 缺少完整的 `try/catch/finally`。
- rejected promise 可能让 busy 一直为 true，乐观消息一直显示 sending。
- HTTP 失败只标记失败，没有按 PRD §7.3 提供可操作重试入口。

修复要求：

- pending message state 保存原始内容、稳定 idempotency key 和失败类型。
- 网络/HTTP/解析异常均进入明确失败状态并解除 busy。
- 用户重试必须复用相同 idempotency key。
- 只有服务端确认未接收答案时才重发答案；已接收但 Run 失败时走 R-01 的 Run 恢复。

### R-10：`finish_interview` 缺少确定性业务授权

证据：

- `lib/interview/agent/tool-registry.ts:98`：非 ask 工具跳过业务规则校验。
- `lib/interview/agent/composition.ts:243`：finish 直接追加消息、切到 scoring 并调度完成任务。

模型可能在 opening、零回答或未满足完成条件时调用 finish，也可能伪造 `user_requested`、`max_rounds` 原因。

修复要求：

- 按持久状态验证 finish reason：用户结束标记、轮次、分类上限、信息增益/覆盖度策略。
- opening 阶段不得仅凭模型自行结束。
- user requested 必须来自确定性用户动作，max rounds 必须由数据库轮次证明。
- 非法工具动作应被拒绝并作为可恢复工具错误返回模型，不能推进状态。

### R-11：Completion 未端到端传播 AbortSignal 和租约校验

证据：

- `lib/interview/completion/scoring.ts:64`：单题评分未接收 signal。
- `lib/interview/report-completion.ts:55`：报告生成未接收 signal。

租约丢失后，旧 Worker 的 AI 请求仍继续运行并可能尝试写结果，浪费费用并与新 Worker 竞争。

修复要求：

- signal 传递到所有结构化生成、单题评分和报告生成调用。
- 每次数据库提交和状态转换都校验 completion job owner + generation。
- 租约续期失败立即 abort；AbortError 不应被误记为业务失败并消耗完整重试预算。

### R-12：半完成的服务幂等流程不能自愈

证据：

- `lib/interview/agent/service.ts:94`：createRun、acceptCandidateMessage、保存 trigger、schedule 是多步骤操作。
- 已创建 Run 后若保存 trigger 或 schedule 失败，相同幂等请求在命中现有 Run 后直接返回，不会补齐缺失步骤。
- opening Run 的创建也存在相似窗口（`lib/interview/agent/service.ts:52`）。

修复要求：

- 优先采用事务 + outbox，将 Run、答案接受和待执行任务原子落库。
- 若分阶段实现，幂等重试必须检查并修复缺失 trigger、未调度、未领取等状态。
- 相同幂等键返回前必须证明该 Run 已经可执行或已经达到终态。

### R-13：每题总分不满足确定性六维加权平均

证据：

- `lib/interview/schemas.ts:14`：模型直接生成整数 overall；反馈数组没有完整的数量约束。
- `lib/interview/completion/scoring.ts:73`：模型结果原样持久化。
- PRD 要求每题 overall 为六维加权平均，示例存在小数分数；优势和问题项也有数量上限。

修复要求：

- 先在完整 PRD 中确认六维权重；若未明确，先更新 PRD/AGENTS.md，经用户确认后再改实现。
- 模型只返回六个维度原始分；服务端按已确认公式计算 overall。
- 数据库和 schema 支持所需小数精度，统一舍入规则。
- strengths、improvements、advice 等字段按 PRD 限制长度和条数。
- 报告 overall 和六维雷达值也由持久化题目分数确定性聚合，不信任模型自行算术。

### R-14：未实现不可变简历快照

证据：

- `lib/db/schema.ts:53`：interviews 直接外键关联 resumeVersions，并设置 `onDelete: cascade`。
- `lib/interview/agent/drizzle-store.ts:19`：创建面试直接绑定当前 resume version，没有生成 snapshot。
- 完整 PRD §5、§6 要求创建面试时形成快照，后续修改或删除简历不能影响历史面试。

修复要求：

- 先确认 PRD 中 snapshot 的字段、删除行为和兼容策略。
- 新增不可变 InterviewResumeSnapshot 表或等价 JSON 快照，面试只依赖快照完成问答和报告。
- 为历史 interview 回填快照，删除 resume/version 时保留面试和报告历史。
- 迁移必须在一次性 PostgreSQL 上验证空库、现有数据和重复运行策略。

### R-15：完成任务重试预算没有总上限

证据：

- `lib/interview/completion/repository.ts:64`：failed job 可反复领取，`attemptCount` 没有形成最终上限。
- `lib/interview/completion/scoring.ts:35`：每次 job 执行又把已耗尽的题目 attemptCount 重置为 0。

外部重复调用 resume 可导致无限次评分/报告 AI 请求。

修复要求：

- 增加 job 级总尝试预算、冷却时间和最终失败状态。
- 不得在普通 resume 中静默重置题目预算。
- 若产品需要人工重试，创建有次数限制的新 retry generation，并记录发起者和原因。

### R-16：clarify 被错误要求证据

`lib/interview/agent/limits.ts:57` 的通用 grounding 校验会落到 clarify 动作，而最新计划允许澄清问题在角色信息不足时不附带简历证据。应只为普通简历问题/追问强制证据，并为 opening clarify 增加专项测试。

### R-17：`targetRole` 只读不写

`targetRole` 会被 context assembler 读取，但当前 opening 仅在可见文本中推断角色，没有确定性持久化。应通过受控工具或 opening 状态转换保存 inferred/confirmed role、置信度和来源，后续问题策略读取同一持久状态。

### R-18：语言和 Persona 缺少强系统指令

`lib/interview/agent/model-port.ts:298` 主要把配置放进 JSON context，未形成清晰、优先级足够高的系统约束。应明确要求候选人可见输出使用所选语言，并让 Friendly/Standard/Stressful 只影响语气和追问强度，不改变评分标准或安全规则。

### R-19：`git diff --check` 失败

多个 `docs/superpowers` Markdown 文件包含行尾空格，其中一部分是 Markdown 的双空格换行。当前验收计划要求 `git diff --check`，两者冲突。应统一文档换行风格，去除被 Git 判定的尾随空格，或明确调整质量门禁；优先使用空行代替双空格强制换行。

## 5. 分阶段实施计划

### Phase 0：确认 PRD 决策与建立测试基线

目标：避免在修 bug 时隐式改变产品规则。

任务：

1. 阅读完整 PRD，确认六维权重、overall 精度/舍入、快照字段和删除语义。
2. 若上述规则未定义，先修改 PRD 和仓库 AGENTS.md，再经用户确认实现。
3. 记录当前数据库 schema 和 migration 序号。
4. 运行并保存基线：test、typecheck、lint、build、diff-check。
5. 为 R-01 至 R-05 先写失败测试，确保修复确实覆盖异常窗口。

完成条件：产品决策明确；所有新增失败测试能够稳定复现对应问题。

### Phase 1：持久化正确性、原子提交和租约 fencing

覆盖：R-02、R-03、R-04、R-05、R-06。

任务：

1. 给 Agent Run 租约增加 generation/fencing token。
2. 所有 Run/Event/Checkpoint/Tool 写入携带 token 并原子校验。
3. 定义并实现 checkpoint 恢复协议和终端工具幂等记录。
4. 把 question、coverage、assistant message、序号和幂等结果合并为单事务。
5. 用户结束时锁定 interview、失效 active Run，并在终端提交再次校验状态。
6. 修正 category 计数查询，并在事务中强制 3 题上限。

完成条件：在两个并发 Worker、租约切换和任意模拟崩溃点下，每个 Run 只产生一个候选人可见结果；旧 Worker 的所有写入被数据库拒绝。

### Phase 2：Run 与 Completion 恢复状态机

覆盖：R-01、R-07、R-08、R-12。

任务：

1. 为“答案已接收、Run 失败”实现独立恢复端点/服务动作。
2. 区分 opening Run、answer Run 和 completion job 的可恢复状态。
3. 为 run/completion resume 增加严格状态、版本、所有权和 job 存在性检查。
4. 用 outbox 或幂等 reconciliation 修复半完成创建流程。
5. 对 stale/unleased/pending 状态提供可靠调度；客户端只作受控唤醒，不轮询触发重复 AI。

完成条件：杀掉首次 `after()` 所在进程后，刷新/受控恢复可继续完成；重复 resume 不产生额外轮次、消息或 AI 任务。

### Phase 3：确定性 Agent 策略

覆盖：R-10、R-16、R-17、R-18。

任务：

1. 给 finish 添加确定性授权规则和拒绝原因。
2. 修正 clarify 的证据例外，但保持普通问题严格 grounding。
3. 持久化 inferred/confirmed targetRole。
4. 强化 language/persona 系统指令及测试。

完成条件：模型无法伪造完成原因或绕过轮次/状态；所有候选人可见输出符合配置语言，Persona 不改变评分规则。

### Phase 4：Completion 可靠性和评分一致性

覆盖：R-11、R-13、R-15。

任务：

1. 将 AbortSignal 和 completion fencing 贯穿评分、报告与所有提交。
2. 实现 job 级有限重试预算、退避和最终失败。
3. 按确认后的 PRD 由服务端计算每题 overall 和报告聚合值。
4. 支持规定的小数精度和反馈数组边界。
5. 确保同一输入重复生成/恢复不会改变已成功的正式分数。

完成条件：租约丢失能取消 AI；总调用次数有硬上限；数据库分数可由六维值完全复算。

### Phase 5：前端错误恢复

覆盖：R-09，并接入 Phase 2 的恢复能力。

任务：

1. 用 `try/catch/finally` 收敛提交状态。
2. 保存 pending answer 的稳定 idempotency key。
3. 分开展示“答案未送达”“答案已接收但 Agent 失败”“连接中断但 Run 仍运行”。
4. 提供符合 PRD 的 retry 入口，并阻止重复点击并发提交。
5. 报告/房间轮询在确定超时后执行一次受控 resume。

完成条件：断网、HTTP 500、SSE 中断、刷新页面和双击提交均不会锁死 UI 或产生重复答案。

### Phase 6：简历快照迁移

覆盖：R-14。该阶段数据迁移风险较高，可独立提交，但在公开使用删除功能前必须完成。

任务：

1. 新建不可变 snapshot schema 和迁移。
2. 创建 interview 时原子复制所需简历内容。
3. Agent context、评分和报告改为读取 snapshot。
4. 回填现有 interview，移除会级联删除历史面试的依赖。
5. 覆盖简历编辑、版本删除、整份简历删除和历史报告读取测试。

完成条件：创建面试后任意修改/删除原简历，面试、问题、评分和报告仍可完整访问且内容不变。

### Phase 7：清理、集成验证与交付

覆盖：R-19 和全部回归。

任务：

1. 清理文档尾随空格，使 `git diff --check` 通过。
2. 在一次性 PostgreSQL 上运行 migration，并验证关键约束。
3. 增加真实数据库的并发、崩溃、租约接管和幂等测试。
4. 运行全部质量门禁，并检查工作区只包含预期改动。
5. 输出剩余风险、迁移说明和人工验证步骤；不自动推送。

## 6. 必须补充的测试

### 数据库与并发集成测试

- 两个 Worker 对同一 Run 竞争领取，只允许一个 winner。
- Worker A 租约过期、B 接管后，A 的 event/checkpoint/terminate/tool commit 全部失败。
- question 事务在每个写入点失败时，要么全部存在，要么全部不存在。
- 两个并发问题请求不能把同一 category 增加到 4。
- 两个相同 idempotency key 的答案请求只增加一次 round。
- 用户结束与 ask/finish 同时发生时，结束后不能出现新问题。

### 崩溃恢复测试

- trigger 保存前后崩溃。
- 模型完成后、工具业务提交前崩溃。
- 工具业务提交后、checkpoint 前崩溃。
- checkpoint 后、Run terminate 前崩溃。
- completion job 创建后、首次调度前崩溃。
- 单题评分成功后、报告生成前崩溃。

### API 状态机测试

- active、legacy configVersion、非 owner 不能调用 completion resume。
- 没有合法 completion job 的面试不能被 resume 推进。
- failed answer Run 可恢复，且不重新接受答案。
- completed/cancelled Run 的重复 resume 是幂等 no-op。
- 非法 finish reason 被确定性策略拒绝。

### 前端测试

- fetch reject 后 busy 解除，消息进入可重试状态。
- retry 复用同一 idempotency key。
- 答案已接收但 Run 失败时只恢复 Run。
- SSE 中断重连不会重复渲染消息或重复触发 resume。
- completion pending 超时后最多触发一次受控恢复。

### 评分与快照测试

- 每题 overall 精确等于 PRD 公式和舍入规则。
- 六维雷达等于所有有效题目的确定性均值。
- strengths/improvements/advice 数量和长度符合 schema。
- 重复 completion 不重算已成功题目，不改变最终报告。
- 删除原 resume/version 后，历史 interview snapshot 与报告保持不变。

## 7. 最终验收门禁

以下条件必须全部满足：

1. 任意崩溃、恢复或租约接管下，每个 Run 只有一个候选人可见结果。
2. 失去租约的 Worker 无法再写 event、checkpoint、业务结果或终态。
3. 用户结束后不再创建新问题或普通 assistant question message。
4. 并发和恢复场景下，每类问题不超过 3，候选回答轮次不超过 20。
5. 重复提交/重试不会增加轮次、重复消息或重复接受答案。
6. 答案已接收后的失败 Run 可恢复，无需重发答案。
7. pending/unleased 任务无需人工改数据库即可恢复。
8. completion/resume 无法推进 active 或 legacy 面试。
9. 每个完成任务的 AI 尝试总数有明确硬上限。
10. 每题 overall 可由六维分数和 PRD 公式确定性复算，并支持规定精度。
11. 报告总体与六维均值由持久化题目分数确定性生成。
12. 简历编辑/删除不影响已创建面试的 snapshot 和历史报告。
13. `pnpm test` 通过。
14. `pnpm exec tsc --noEmit` 通过。
15. `pnpm lint` 无错误，并处理本次范围内新增 warning。
16. `pnpm build` 通过。
17. `git diff --check` 通过。
18. migration 在一次性 PostgreSQL 上从空库和现有 schema 均验证通过。
19. 工作区只包含预期改动，不自动 commit 或 push，除非用户另行要求。

## 8. 本次审查验证基线

已运行：

- `pnpm test`：203/203 通过。
- `pnpm exec tsc --noEmit`：通过。
- `pnpm lint`：0 error，2 warning。
  - `.agents/skills/shadcn-ui/examples/data-table.tsx`：React Compiler warning。
  - `components/interview/interview-resume-context-sheet.tsx`：未使用的 `SheetDescription`。
- `pnpm build`：通过。
- `git diff --check 29a7f24405a1dffe2d6be70f6a96843102e8cf38..ce161f9027eb49f1c1b4fdc504adbc851817e35b`：失败，原因是 `docs/superpowers` 中多处 Markdown 尾随空格。

未运行：

- 真实 PostgreSQL migration 和并发集成测试：会连接/修改数据库，本次审查是只读任务。
- 真实 AI/provider contract 测试：需要外部服务和费用，应在明确环境变量及预算后执行。

## 9. 当前实现值得保留的部分

修复时不要破坏以下已有能力：

- 新增 API 基本具备 owner 校验和 Run/Interview 配对校验。
- 输入 schema 使用严格 Zod、UUID、长度和枚举约束。
- 正式六维评分已从面试中移到 completion 阶段。
- SSE 对外事件有 allowlist，内部敏感事件未直接暴露。
- AI 错误对用户进行了基本清洗。
- 候选答案路径已有 advisory lock 和唯一幂等约束基础。
- 纯函数和内存仓库测试覆盖较多，可作为新增数据库集成测试的快速反馈层。

## 10. 建议的提交拆分

为方便审查和回滚，建议按以下逻辑提交，避免一个提交混合迁移、状态机、UI 和评分变化：

1. `test(agent): cover lease takeover and crash recovery gaps`
2. `fix(agent): fence leased run writes`
3. `fix(agent): make terminal question commits atomic`
4. `fix(agent): restore checkpoints and recover accepted answers`
5. `fix(completion): enforce resumable state transitions`
6. `fix(agent): authorize completion and category limits`
7. `fix(completion): bound retries and compute deterministic scores`
8. `fix(interview): add immutable resume snapshots`
9. `fix(ui): support idempotent answer and run retries`
10. `test(interview): add postgres recovery integration coverage`
11. `docs(superpowers): align remediation and validation gates`

提交只是建议；除非用户在新对话中明确要求，不要自动提交或推送。
