import type { MeetingStatus } from "@lib/types/meeting.ts";

export function Status({ status }: { status: MeetingStatus }) {
  const labels: Record<MeetingStatus, string> = {
    queued: "In the queue",
    transcribing: "Transcribing",
    summarizing: "Writing notes",
    ready: "Needs review",
    saved: "Saved to matter",
    failed: "Needs attention",
    deleting: "Deletion pending",
  };
  return (
    <span className={`status ${status}`}>
      <i />
      {labels[status]}
    </span>
  );
}
