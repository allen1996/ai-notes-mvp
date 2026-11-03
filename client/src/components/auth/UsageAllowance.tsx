import { ArrowUpRight, Sparkles } from "lucide-react";
import type { AiUsage } from "@lib/types/usage.ts";

export function UsageAllowance(
  { usage, upgrade }: { usage: AiUsage | null; upgrade: () => void },
) {
  return (
    <div className="usage-allowance">
      <div className="usage-heading">
        <Sparkles size={15} />
        <span>Free AI notes</span>
        <strong aria-live="polite">
          {usage ? `${usage.remaining} / ${usage.limit}` : "—"}
        </strong>
      </div>
      <div className="usage-credits" aria-hidden="true">
        {Array.from(
          { length: usage?.limit ?? 3 },
          (_, index) => (
            <span
              key={index}
              className={usage && index < usage.remaining ? "available" : ""}
            />
          ),
        )}
      </div>
      <button onClick={upgrade}>
        Upgrade plan<ArrowUpRight size={14} />
      </button>
    </div>
  );
}
