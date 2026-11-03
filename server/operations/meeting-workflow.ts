import { type Meeting, type MeetingSource } from "@lib/types/meeting.ts";
import { billableMinutes, isProcessing } from "@lib/utils/meeting.ts";
import { AppError } from "@server/utils/errors.ts";
import { Repository } from "@server/tables/repository.ts";
import type { NoteProvider } from "@server/models/note-provider.ts";
import type { AudioStorage } from "@server/infra/audio-storage.ts";
import {
  CreateMeetingSchema,
  parseInput,
  PatchMeetingSchema,
  SaveMeetingSchema,
} from "@server/models/inputs.ts";

export class Workflow {
  private running = new Map<
    string,
    { job: Promise<void>; controller: AbortController }
  >();
  private deleting = new Map<string, Promise<void>>();
  constructor(
    readonly repo: Repository,
    private providers: { mock: NoteProvider; assemblyai: NoteProvider },
    readonly aiProvider: "mock" | "assemblyai",
    private audio?: Pick<AudioStorage, "remove">,
  ) {}

  async create(
    rawInput: {
      title: unknown;
      source: MeetingSource;
      consent: unknown;
      duration?: number;
      audioPath?: string;
      audioMime?: string;
    },
  ): Promise<Meeting> {
    const input = parseInput(CreateMeetingSchema, rawInput);
    const now = new Date().toISOString();
    const meeting: Meeting = {
      id: crypto.randomUUID(),
      title: input.title,
      createdAt: now,
      updatedAt: now,
      consentAt: now,
      status: "queued",
      source: input.source,
      provider: input.source === "demo" ? "mock" : this.aiProvider,
      duration: input.duration ?? 0,
      matterId: null,
      notes: null,
      personalNotes: "",
      utterances: [],
      transcript: "",
      audioPath: input.audioPath,
      audioMime: input.audioMime,
    };
    await this.repo.createMeeting(meeting, meeting.source !== "demo");
    this.enqueue(meeting.id);
    return meeting;
  }

  enqueue(id: string): Promise<void> {
    const existing = this.running.get(id);
    if (existing) return existing.job;
    const controller = new AbortController();
    const job = this.process(id, controller.signal).finally(() =>
      this.running.delete(id)
    );
    this.running.set(id, { job, controller });
    return job;
  }

  private async process(id: string, signal: AbortSignal) {
    try {
      let meeting = await this.repo.getMeeting(id);
      if (!isProcessing(meeting.status)) return;
      const provider = this.providers[meeting.provider];
      // A persisted transcript avoids another transcription charge after a notes failure/restart.
      if (!meeting.transcript) {
        await this.repo.update(
          id,
          (m) => ({ ...m, status: "transcribing", error: undefined }),
        );
        const transcript = await provider.transcribe(
          meeting,
          async (transcriptId) => {
            signal.throwIfAborted();
            await this.repo.update(id, (m) => ({ ...m, transcriptId }));
          },
          signal,
        );
        signal.throwIfAborted();
        meeting = await this.repo.update(
          id,
          (m) => ({
            ...m,
            transcript: transcript.text,
            utterances: transcript.utterances,
            duration: transcript.duration,
            status: "summarizing",
          }),
        );
      } else {
        meeting = await this.repo.update(
          id,
          (m) => ({ ...m, status: "summarizing", error: undefined }),
        );
      }
      const notes = await provider.summarize(
        {
          text: meeting.transcript,
          utterances: meeting.utterances,
          duration: meeting.duration,
        },
        meeting,
        signal,
      );
      signal.throwIfAborted();
      await this.repo.update(
        id,
        (m) => ({ ...m, notes, status: "ready", error: undefined }),
      );
    } catch (error) {
      if (signal.aborted) return;
      try {
        await this.repo.update(
          id,
          (m) => ({
            ...m,
            status: "failed",
            error: error instanceof Error
              ? error.message
              : "Processing failed. Please retry.",
          }),
        );
      } catch (writeError) {
        if (
          !(writeError instanceof AppError &&
            (writeError.status === 404 ||
              writeError.code === "DELETION_IN_PROGRESS"))
        ) throw writeError;
      }
    }
  }

  async retry(id: string) {
    const meeting = await this.repo.retryMeeting(id);
    this.enqueue(id);
    return meeting;
  }

  async patch(id: string, rawInput: Record<string, unknown>) {
    const input = parseInput(PatchMeetingSchema, rawInput);
    if (
      input.matterId !== undefined && input.matterId !== null &&
      !await this.repo.getMatter(input.matterId)
    ) throw new AppError(400, "Choose an existing matter.");
    return this.repo.update(id, (m) => {
      if (m.status !== "ready") {
        throw new AppError(
          409,
          "Only meetings ready for review can be edited. Saved records are read-only.",
        );
      }
      const next = { ...m };
      if (input.title !== undefined) {
        next.title = input.title;
      }
      if (input.personalNotes !== undefined) {
        next.personalNotes = input.personalNotes;
      }
      if (input.matterId !== undefined) {
        next.matterId = input.matterId;
      }
      if (input.notes !== undefined) next.notes = input.notes;
      return next;
    });
  }

  async saveToMatter(id: string, reviewed: unknown) {
    parseInput(SaveMeetingSchema, { reviewed });
    const meeting = await this.repo.getMeeting(id);
    if (!meeting.matterId || !await this.repo.getMatter(meeting.matterId)) {
      throw new AppError(400, "Select a matter before saving.");
    }
    return this.repo.exportMeeting(id, (m) => {
      if (m.status !== "ready" || !m.notes || !m.matterId) {
        throw new AppError(409, "Meeting is not ready to save.");
      }
      return {
        id: `mock-${id}`,
        meetingId: id,
        matterId: m.matterId,
        createdAt: new Date().toISOString(),
        minutes: billableMinutes(m.duration),
        provider: "mock-clio",
        summary: m.notes.summary,
        keyPoints: m.notes.keyPoints,
        actions: m.notes.actions,
        transcript: m.transcript,
        personalNotes: m.personalNotes,
      };
    });
  }

  async resume() {
    for (const m of await this.repo.listMeetings()) {
      if (m.status === "deleting") void this.delete(m.id).catch(() => {});
      if (isProcessing(m.status)) this.enqueue(m.id);
    }
  }
  async idle() {
    await Promise.all([...this.running.values()].map(({ job }) => job));
    await Promise.all(this.deleting.values());
  }
  delete(id: string, audio = this.audio): Promise<void> {
    const existing = this.deleting.get(id);
    if (existing) return existing;
    const job = this.performDeletion(id, audio).finally(() =>
      this.deleting.delete(id)
    );
    this.deleting.set(id, job);
    return job;
  }
  private async performDeletion(
    id: string,
    audio?: Pick<AudioStorage, "remove">,
  ) {
    const meeting = await this.repo.beginDeletion(id);
    this.running.get(id)?.controller.abort();
    // Persist the tombstone first. A failed cleanup can be safely retried after restart.
    if (meeting.audioPath) {
      if (!audio) {
        throw new AppError(503, "Audio storage isn't configured for deletion.");
      }
      await audio.remove(meeting.audioPath);
    }
    await this.repo.finishDeletion(id);
  }
}
