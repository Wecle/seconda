# Seconda Agent 覆盖度提案修复契约设计

**日期：** 2026-07-16

**状态：** 已批准

**范围：** 回答轮轻量评估、覆盖度变化提案、确定性授权失败详情、终结提案有界修复与回归测试

**不改变：** 六维评分模型、覆盖度状态推导规则、每类 3 题上限、全局 20 轮上限、完成条件、简历快照、修复预算、数据库 Schema、公开事件协议

## 1. 故障背景

面试 `8dd2a9c9-b02c-4306-9469-fdbb3697ef1e` 的回答 Run `a1c8b09a-cd12-4d4d-82ad-159a34bfe83c` 在读取到完整简历证据、面试历史和覆盖度后仍然失败。三个终结修复额度依次消耗在：

1. `CONTRADICTORY_COVERAGE_CHANGE`；
2. `RESPONSE_BEFORE_AUTHORIZATION`；
3. `CONTRADICTORY_COVERAGE_CHANGE`。

Runtime 最终以 `terminal_action_failed` 结束，并向候选人展示“本轮问题生成未能通过运行规则，请重试。”

确定性授权器的规则本身正确：当前回答分类的规范覆盖状态由轻量评估确定，`followUpNeeded = true` 对应 `partial`，`followUpNeeded = false` 对应 `sufficient`，达到该分类第 3 题时对应 `exhausted`。问题在于模型可见的工具 Schema 和 Prompt 没有表达这组关系，而失败修复只告诉模型“根据失败代码修正结构化行动”，没有提供冲突分类、期望状态或实际状态。

## 2. 目标

- 让模型在首次生成时能够构造与确定性覆盖度规则一致的终结提案。
- 当模型仍生成冲突提案时，返回足够具体且不泄露内部状态的修复信息。
- 保留确定性授权为唯一权威，不静默改写模型表达的互相矛盾的业务含义。
- 用本次“自我介绍回答后生成下一题”的失败形态建立 Runtime 回归保护。

## 3. 方案选择

### 3.1 采用：契约对齐与精准修复反馈

在现有单 Agent 调用和单个 `submit_interview_turn` 工具中完成修复：

1. 为轻量评估、覆盖度变化和状态字段补充模型可见的 Schema 描述。
2. 在系统 Prompt 与 `answer-planning` Skill 中写明覆盖状态映射和合法变更范围。
3. 确定性授权失败时返回结构化的覆盖冲突详情。
4. Runtime 将详情转换为一条可执行的中文修复指令。
5. 保持三次终结修复预算和 terminal-only 修复模式不变。

该方案不增加模型调用，不放宽规则，也不需要迁移历史数据。

### 3.2 不采用：只补 Prompt

只补 Prompt 改动最少，但 Prompt 不能成为业务规则的唯一来源。模型仍可能输出冲突值，通用错误提示仍会造成重复失败。

### 3.3 不采用：授权器自动覆盖冲突状态

把模型提交的状态静默改写为服务端推导值可以降低失败率，但会隐藏 `assessment` 与 `coverageChanges` 的语义冲突，也会使调试与后续规则演进更困难。授权器继续拒绝冲突提案。

## 4. 覆盖度生成契约

回答轮的 `assessment` 必须非空。令当前被回答问题的分类为 `answerCategory`：

- 当该分类累计题数小于 3 时：
  - `assessment.followUpNeeded = true`，当前分类的规范状态为 `partial`；
  - `assessment.followUpNeeded = false`，当前分类的规范状态为 `sufficient`。
- 当该分类累计题数达到 3 时，当前分类的规范状态为 `exhausted`，无论 `followUpNeeded` 为何值。
- `coverageChanges` 中属于 `answerCategory` 的条目必须使用该规范状态。
- `coverageChanges` 中属于其他分类的条目不得改变该分类当前的规范聚合状态；这类条目仅允许在状态保持一致时补充主题和证据。
- `exhausted` 不能在分类题数小于 3 时由模型提前声明。
- 模型通常只应为当前回答分类提交 `coverageChanges`，避免为未被本轮回答触达的分类生成无效变化。

Opening 保持现状：`assessment` 必须为 `null`，`coverageChanges` 必须为空。

## 5. 结构化失败详情

`authorizeTurnProposal` 继续返回稳定的顶层拒绝码 `CONTRADICTORY_COVERAGE_CHANGE`，并为该拒绝码附加一个内部结构化详情：

```ts
type CoverageConflictDetail = {
  category: QuestionCategory;
  topic: string;
  receivedStatus: CoverageStatus;
  expectedStatuses: CoverageStatus[];
  conflictKind:
    | "assessment_status_mismatch"
    | "premature_exhausted"
    | "non_answer_category_change";
};
```

各冲突类型含义：

- `assessment_status_mismatch`：当前回答分类的条目与 `followUpNeeded` 推导状态不一致。
- `premature_exhausted`：分类尚未达到 3 题却提交 `exhausted`。
- `non_answer_category_change`：本轮尝试改变非当前回答分类的聚合状态。

详情只包含公开业务枚举、分类和模型已提交的主题，不包含数据库 ID、Run ID、Prompt、权限数据或供应商信息。

## 6. Runtime 修复反馈

Runtime 在把授权拒绝转换为 `AttemptFailure` 时保留覆盖冲突详情。`repairInstruction` 对 `CONTRADICTORY_COVERAGE_CHANGE` 生成固定、可执行的指导：

```text
coverageChanges 中分类 introduction、主题“自我介绍”的状态应为 sufficient，不能为 partial。followUpNeeded=false 时使用 sufficient，true 时使用 partial；分类达到第 3 题时使用 exhausted。仅修正冲突状态并重新生成完整提案。
```

具体文本按详情生成，但必须满足：

- 指出冲突分类和主题；
- 列出期望状态与收到的状态；
- 解释 `followUpNeeded` 映射和第 3 题规则；
- 不输出原始提案 JSON；
- 不增加修复次数；
- 继续要求 `responseText` 最后生成。

如果缺少结构化详情，例如从旧 Checkpoint 恢复，只使用包含完整状态映射的通用覆盖度修复提示，不能退回“根据失败代码修正结构化行动”。

`RESPONSE_BEFORE_AUTHORIZATION` 的现有协议规则和修复提示保持不变。本设计通过减少前缀业务冲突，降低模型在修复时重新排列或提前生成 `responseText` 的概率，但不放宽授权前禁止公开正文的安全边界。

## 7. 数据流

```text
最新回答 + 当前覆盖度
  -> 模型按 Schema/Prompt 生成 assessment + coverageChanges + decision
  -> readTurnProposalProgress 读取完整前缀
  -> authorizeTurnProposal 推导规范覆盖状态
     -> 一致：授权 proposalHash，开始 responseText 流
     -> 冲突：返回稳定错误码 + CoverageConflictDetail
  -> Runtime 生成精准修复提示
  -> terminal-only 下一 attempt 重新提交完整提案
  -> 最终事务锁定最新状态并再次执行同一授权规则
```

授权阶段与最终事务继续调用同一个 `authorizeTurnProposal`，避免预授权和提交时出现两套覆盖度规则。

## 8. 代码影响面

- `lib/interview/agent/turn-proposal.ts`
  - 为评估、覆盖变化和状态字段增加模型可见描述。
- `lib/interview/agent/model-port.ts`
  - 在系统 Prompt 中加入确定性状态映射与合法变更范围。
- `lib/interview/agent/skills.ts`
  - 在 `answer-planning` 指令中加入相同契约。
- `lib/interview/agent/turn-authorizer.ts`
  - 返回 `CoverageConflictDetail`，不改变允许/拒绝结果。
- `lib/interview/agent/runtime.ts`
  - 将授权详情传入 `AttemptFailure`，生成精准修复提示。
- 对应测试文件
  - 覆盖 Schema/Prompt、授权详情和 Runtime 有界修复。

不修改数据库表、API 路由、前端组件、评分服务或历史 Run。

## 9. 测试策略

### 9.1 授权器单元测试

- `followUpNeeded=true`、收到 `sufficient` 时返回 `assessment_status_mismatch`，期望 `partial`。
- `followUpNeeded=false`、收到 `partial` 时返回 `assessment_status_mismatch`，期望 `sufficient`。
- 少于 3 题收到 `exhausted` 时返回 `premature_exhausted`。
- 非当前回答分类发生状态变化时返回 `non_answer_category_change`。
- 合法状态继续授权并保持既有 proposal hash 行为。

### 9.2 Prompt 与 Schema 契约测试

- 系统 Prompt 和 `answer-planning` Skill 明确包含 `followUpNeeded` 映射。
- 生成给供应商的工具 Schema 包含覆盖状态语义描述。
- `responseText` 仍为最后一个字段，Opening 约束不变。

### 9.3 Runtime 回归测试

模拟本次失败形态：

1. 当前回答分类为 `introduction`，题数为 1；
2. 首个终结提案提交 `followUpNeeded=false` 与 `status=partial`；
3. Runtime 丢弃提案且修复消息明确要求 `sufficient`；
4. 第二个提案改为 `status=sufficient`；
5. Run 在剩余预算内提交下一题；
6. 只产生一次正式轻量评估、一次正式问题和一个 `message_committed`。

保留现有测试，证明三次失败仍会产生 `terminal_action_failed`，授权前正文仍不会公开，分类和全局上限均未放宽。

### 9.4 验证命令

```bash
pnpm exec tsx --test lib/interview/agent/turn-proposal.test.ts lib/interview/agent/model-port.test.ts lib/interview/agent/skills.test.ts lib/interview/agent/turn-authorizer.test.ts lib/interview/agent/runtime.test.ts
pnpm test
npx tsc --noEmit
pnpm lint
pnpm build
```

不运行会修改当前失败面试历史的重放操作。修复发布后由用户在页面发起新的重试 Run。

## 10. 验收标准

1. 模型可从工具 Schema、系统 Prompt 和 Skill 指令得知覆盖状态映射。
2. `CONTRADICTORY_COVERAGE_CHANGE` 修复提示包含冲突分类、期望状态和实际状态。
3. 本次自我介绍回答场景能在一次覆盖冲突后于下一终结 attempt 成功提交。
4. 三次终结失败预算、terminal-only 修复模式与失败用户文案保持不变。
5. 确定性授权器仍拒绝所有矛盾状态，不静默修正。
6. 最终事务继续基于锁定后的最新状态再次验证。
7. 不增加模型调用，不迁移数据库，不改变评分或面试流程。
