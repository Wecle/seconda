import { CheckCircle2 } from "lucide-react";
import type { CommittedArtifact } from "@/lib/interview/agent/contracts";

export function AgentArtifactCard({ artifact }: { artifact: CommittedArtifact }) {
  return <div className="max-w-[86%] rounded-xl border bg-muted/40 px-4 py-3 text-sm">
    <div className="flex items-center gap-2 font-medium"><CheckCircle2 className="size-4 text-emerald-600" />{artifact.title}</div>
    <p className="mt-1 text-muted-foreground">{artifact.summary}</p>
    {artifact.details.length > 0 && <details className="mt-2"><summary className="cursor-pointer">查看详情</summary><ul className="mt-1 list-disc pl-5">{artifact.details.map((detail) => <li key={detail}>{detail}</li>)}</ul></details>}
  </div>;
}
