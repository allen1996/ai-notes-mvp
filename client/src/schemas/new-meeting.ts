import type { MeetingSource } from "@lib/types/meeting.ts";

/** Client feedback only; the server independently validates every upload. */
export function validateNewMeeting(input: {
  source: MeetingSource;
  consent: boolean;
  file: File | null;
}): string | null {
  if (!input.consent) return "Please confirm participant consent first.";
  if (input.source !== "demo" && !input.file) {
    return "Record a meeting or choose an audio file first.";
  }
  return null;
}
