import type { MeetingStatus } from "@lib/types/meeting.ts";

export const isProcessing = (status: MeetingStatus) =>
  ["queued", "transcribing", "summarizing"].includes(status);
export const billableMinutes = (seconds: number) =>
  Math.max(6, Math.ceil(seconds / 360) * 6);
export const formatDuration = (seconds: number) =>
  `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${
    Math.floor(seconds % 60).toString().padStart(2, "0")
  }`;
