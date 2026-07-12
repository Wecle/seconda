import type { CommittedArtifact } from "./contracts";

export function publicArtifactFromToolCompletion(input: {
  toolName: string;
  runId: string;
  callId: string;
}): CommittedArtifact | null {
  if (input.toolName === "update_coverage") return {
    artifactId: `coverage:${input.runId}:${input.callId}`,
    type: "background_saved",
    title: "背景已保存",
    summary: "已将本轮回答中的有效背景更新到面试上下文。",
    details: [],
  };
  if (input.toolName === "finish_interview") return {
    artifactId: `completion:${input.runId}`,
    type: "scoring_created",
    title: "评估任务已创建",
    summary: "面试已结束，系统将统一完成正式评分并生成报告。",
    details: [],
  };
  return null;
}
