import { ArrowLeft, Check, Sparkles } from "lucide-react";
import type { AiUsage } from "@lib/types/usage.ts";

export function Upgrade(
  { usage, back, example }: {
    usage: AiUsage | null;
    back: () => void;
    example: () => void;
  },
) {
  return (
    <section className="upgrade-page">
      <button className="text-button" onClick={back}>
        <ArrowLeft size={15} />Back to meetings
      </button>
      <div className="upgrade-intro">
        <span className="upgrade-icon">
          <Sparkles size={27} />
        </span>
        <h2>
          {usage?.remaining === 0
            ? "You’ve used your free AI notes."
            : "More room for your conversations."}
        </h2>
        <p>
          Your account includes 3 free AI notes. Each recording or retry uses
          one. Examples are always free.
        </p>
      </div>
      <div className="plan-grid">
        <div className="plan-card">
          <span className="plan-label">Your plan</span>
          <h3>Free</h3>
          <p className="plan-allowance">
            {usage
              ? `${usage.remaining} of ${usage.limit} AI notes left`
              : "3 AI notes included"}
          </p>
          <ul>
            <li>
              <Check size={16} />Record or upload audio
            </li>
            <li>
              <Check size={16} />Review and edit your notes
            </li>
            <li>
              <Check size={16} />Unlimited example meetings
            </li>
          </ul>
          <button className="button secondary" onClick={example}>
            Try an example
          </button>
        </div>
        <div className="plan-card coming-soon">
          <span className="plan-label">Coming soon</span>
          <h3>Pro</h3>
          <p className="plan-allowance">Keep the notes coming.</p>
          <ul>
            <li>
              <Check size={16} />More AI notes
            </li>
            <li>
              <Check size={16} />More recording capacity
            </li>
          </ul>
          <button className="button primary" disabled>
            Upgrade unavailable
          </button>
        </div>
      </div>
    </section>
  );
}
