import type { Meeting, Notes, Utterance } from "@lib/types/meeting.ts";
export interface Transcription {
  text: string;
  utterances: Utterance[];
  duration: number;
}
export interface NoteProvider {
  transcribe(
    meeting: Meeting,
    onSubmitted: (id: string) => Promise<void>,
    signal?: AbortSignal,
  ): Promise<Transcription>;
  summarize(
    transcription: Transcription,
    meeting: Meeting,
    signal?: AbortSignal,
  ): Promise<Notes>;
}
