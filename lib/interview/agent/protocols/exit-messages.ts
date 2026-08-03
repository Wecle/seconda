import type { AgentExitReason } from "@/lib/interview/agent/protocols/runtime";

const messages: Record<AgentExitReason, string> = {
  completed: "本轮处理已完成。",
  max_turns: "本轮处理达到最大步骤数，请重试。",
  provider_failed: "模型服务暂时不可用，请稍后重试。",
  terminal_action_failed: "本轮问题生成未能通过运行规则，请重试。",
  aborted_streaming: "模型连接中断，请重试本轮回答。",
  aborted_tools: "后台操作中断，请重试。",
  hook_stopped: "本轮处理被安全规则终止。",
  blocking_limit: "检测到重复处理，本轮已停止，请重试。",
  prompt_too_long: "面试上下文过长，暂时无法继续。",
};

export function agentExitMessage(reason: AgentExitReason | null, error?: unknown) {
  if (reason === "provider_failed" && hasResourceBudgetCode(error)) {
    return "本轮处理达到资源保护上限，请稍后重试。";
  }
  return reason ? messages[reason] : null;
}

function hasResourceBudgetCode(error: unknown): boolean {
  let current = error;
  const seen = new Set<object>();
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const code = (current as { code?: unknown }).code;
    if (code === "AI_RESOURCE_BUDGET_EXCEEDED" || code === "AI_RESOURCE_BUDGET_UNAVAILABLE") {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
