import { useState } from "react";
import { Trash2 } from "lucide-react";
import type { Meeting } from "@lib/types/meeting.ts";
import { useApi } from "@client/hooks/useApi.ts";
import { ApiError } from "@client/lib/api.ts";
import { Modal } from "@client/components/ui/Modal.tsx";
import { Spinner } from "@client/components/ui/Spinner.tsx";

export function DeleteMeeting({ meeting, close, deleted, updated }: {
  meeting: Meeting;
  close: () => void;
  updated: (meeting: Meeting) => void;
  deleted: (id: string) => void;
}) {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function remove() {
    setBusy(true);
    setError("");
    try {
      await api.deleteMeeting(meeting.id);
      deleted(meeting.id);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 404) {
        deleted(meeting.id);
        return;
      }
      try {
        updated(await api.meeting(meeting.id));
      } catch {
        /* Keep the confirmation available if the network is still unavailable. */
      }
      setError("We couldn't finish deleting this meeting. Please try again.");
      setBusy(false);
    }
  }
  return (
    <Modal title="Delete meeting?" close={close} small busy={busy}>
      <p className="dialog-description">
        Permanently delete{" "}
        <strong>{meeting.title}</strong>, including its notes and recording?
      </p>
      <p className="dialog-hint">
        This can’t be undone. Used AI notes won’t be restored.
      </p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="modal-footer">
        <button className="button secondary" disabled={busy} onClick={close}>
          Cancel
        </button>
        <button className="button destructive" disabled={busy} onClick={remove}>
          {busy ? <Spinner /> : <Trash2 size={15} />}
          {busy ? "Deleting…" : "Delete meeting"}
        </button>
      </div>
    </Modal>
  );
}
