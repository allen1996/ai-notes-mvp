import { type FormEvent, useState } from "react";
import { Plus } from "lucide-react";
import type { Matter } from "@lib/types/meeting.ts";
import { useApi } from "@client/hooks/useApi.ts";
import { Modal } from "@client/components/ui/Modal.tsx";
import { Spinner } from "@client/components/ui/Spinner.tsx";

export function NewMatter(
  { close, created }: { close: () => void; created: (matter: Matter) => void },
) {
  const api = useApi();
  const [name, setName] = useState("");
  const [client, setClient] = useState("");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      created(await api.createMatter({ name, client, reference }));
    } catch (cause) {
      setError((cause as Error).message);
      setBusy(false);
    }
  }
  return (
    <Modal
      title="New matter"
      close={() => {
        if (!busy) close();
      }}
    >
      <form className="matter-form" onSubmit={submit}>
        <label className="field">
          Matter name<input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={200}
            placeholder="e.g. Mitchell · Property purchase"
          />
        </label>
        <div className="form-row">
          <label className="field">
            Client<input
              value={client}
              onChange={(e) => setClient(e.target.value)}
              required
              maxLength={200}
              placeholder="Sarah Mitchell"
            />
          </label>
          <label className="field">
            Matter reference<input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              required
              maxLength={50}
              placeholder="MAT-1043"
            />
          </label>
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="modal-footer">
          <button className="button primary" disabled={busy}>
            {busy ? <Spinner /> : <Plus size={16} />}Create matter
          </button>
        </div>
      </form>
    </Modal>
  );
}
