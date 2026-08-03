import assert from "node:assert/strict";
import test from "node:test";
import { agentExitMessage } from "@/lib/interview/agent/protocols/exit-messages";

test("maps agent exit reasons to stable user messages", () => {
  assert.equal(agentExitMessage("terminal_action_failed"), "本轮问题生成未能通过运行规则，请重试。");
  assert.equal(agentExitMessage("provider_failed"), "模型服务暂时不可用，请稍后重试。");
  assert.equal(agentExitMessage("blocking_limit"), "检测到重复处理，本轮已停止，请重试。");
  assert.equal(
    agentExitMessage("provider_failed", { code: "AI_RESOURCE_BUDGET_EXCEEDED" }),
    "本轮处理达到资源保护上限，请稍后重试。",
  );
  assert.equal(
    agentExitMessage("provider_failed", {
      cause: { code: "AI_RESOURCE_BUDGET_UNAVAILABLE" },
    }),
    "本轮处理达到资源保护上限，请稍后重试。",
  );
  assert.equal(agentExitMessage(null), null);
});
