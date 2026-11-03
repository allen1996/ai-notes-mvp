import {
  demoNotes,
  demoTranscript,
  demoUtterances,
} from "@lib/fixtures/demo.ts";
import type { Meeting, Notes } from "@lib/types/meeting.ts";
import type {
  NoteProvider,
  Transcription,
} from "@server/models/note-provider.ts";

export class MockProvider implements NoteProvider {
  constructor(private delay = 850) {}
  async transcribe(meeting: Meeting): Promise<Transcription> {
    await new Promise((resolve) => setTimeout(resolve, this.delay));
    if (meeting.source === "demo") {
      return {
        text: demoTranscript,
        utterances: structuredClone(demoUtterances),
        duration: 227,
      };
    }
    const text =
      "Mock mode: your audio was captured, but it has not been transcribed. Enable AssemblyAI on the server and create a new meeting to generate notes from real audio.";
    return { text, utterances: [], duration: meeting.duration };
  }
  async summarize(
    _transcription: Transcription,
    meeting: Meeting,
  ): Promise<Notes> {
    await new Promise((resolve) => setTimeout(resolve, this.delay));
    if (meeting.source === "demo") return structuredClone(demoNotes);
    return {
      summary:
        "This is a mock result. No audio content was analysed. Your recording is available for playback. Set AI_PROVIDER=assemblyai and provide ASSEMBLYAI_API_KEY on the server, then create a new meeting for real transcription and notes.",
      keyPoints: [
        "Audio captured successfully. Content has not been analysed in mock mode.",
      ],
      actions: [],
    };
  }
}
