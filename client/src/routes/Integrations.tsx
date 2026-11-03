import { AudioLines } from "lucide-react";
import type { AppConfig } from "@lib/types/meeting.ts";

export function Integrations({ config }: { config: AppConfig | null }) {
  const connected = config?.aiProvider === "assemblyai";
  return (
    <section className="integrations-section">
      <div className="integration-card">
        <div className="integration-logo assembly">
          <AudioLines size={26} />
        </div>
        <div className="integration-info">
          <h2>AssemblyAI</h2>
          <p>
            Transcribe recordings and turn conversations into meeting notes.
          </p>
          <span
            className={`integration-status ${connected ? "connected" : ""}`}
          >
            <i />
            {connected ? "Connected" : "Not connected"}
          </span>
        </div>
      </div>
      <div className="integration-card">
        <div className="integration-logo clio">clio</div>
        <div className="integration-info">
          <h2>Clio</h2>
          <p>
            Send reviewed notes and time entries to your practice management
            system.
          </p>
          <span className="integration-status">
            <i />Not connected
          </span>
        </div>
      </div>
    </section>
  );
}
