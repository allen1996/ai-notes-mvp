import { billableMinutes } from "@lib/utils/meeting.ts";
import { Repository } from "@server/tables/repository.ts";
import { MockProvider } from "@server/infra/mock-note-provider.ts";
import { Workflow } from "@server/operations/meeting-workflow.ts";
import {
  assert,
  equal,
  fixture,
  readyMeeting,
  rejects,
} from "@server/utils/test-helpers.ts";

Deno.test("core workflow: capture → transcription → editable notes → reviewed matter save", async () => {
  const { repo, workflow, close } = fixture();
  try {
    const meeting = await readyMeeting(workflow);
    equal(meeting.status, "ready");
    assert(meeting.notes?.summary.includes("Sarah Mitchell"));
    assert(meeting.utterances.length > 0);
    await repo.createMatter({
      id: "m1",
      reference: "MAT-1",
      client: "Sarah",
      name: "Purchase",
    });
    await workflow.patch(meeting.id, {
      matterId: "m1",
      personalNotes: "Follow up on Monday",
      notes: { ...meeting.notes!, summary: "Reviewed summary" },
    });
    const saved = await workflow.saveToMatter(meeting.id, true);
    equal(saved.status, "saved");
    equal(saved.export?.summary, "Reviewed summary");
    equal(saved.export?.personalNotes, "Follow up on Monday");
    equal(saved.export?.minutes, 6);
    equal(saved.export?.transcript, meeting.transcript);
    equal(saved.export?.matterId, "m1");
    equal(saved.export?.actions.length, meeting.notes?.actions.length);
    assert(saved.export?.keyPoints.length);
  } finally {
    await close();
  }
});

Deno.test("recording requires consent, a valid title, and audio", async () => {
  const { workflow, close } = fixture();
  try {
    await rejects(
      () => workflow.create({ title: "Test", source: "demo", consent: false }),
      "consent",
    );
    await rejects(
      () => workflow.create({ title: " ", source: "demo", consent: true }),
      "title",
    );
    await rejects(
      () => workflow.create({ title: "Test", source: "upload", consent: true }),
      "recording",
    );
  } finally {
    await close();
  }
});

Deno.test("matter save requires review and a real local matter", async () => {
  const { workflow, close } = fixture();
  try {
    const m = await readyMeeting(workflow);
    await rejects(() => workflow.saveToMatter(m.id, false), "Review");
    await rejects(() => workflow.saveToMatter(m.id, true), "Select a matter");
    await rejects(
      () => workflow.patch(m.id, { matterId: "missing" }),
      "existing matter",
    );
  } finally {
    await close();
  }
});

Deno.test("concurrent saves create one export and one time entry; saved notes are immutable", async () => {
  const { repo, workflow, close } = fixture();
  try {
    const m = await readyMeeting(workflow);
    await repo.createMatter({
      id: "m1",
      reference: "MAT-1",
      client: "Sarah",
      name: "Purchase",
    });
    await workflow.patch(m.id, { matterId: "m1" });
    const results = await Promise.all(
      Array.from({ length: 8 }, () => workflow.saveToMatter(m.id, true)),
    );
    assert(results.every((r) => r.export?.id === results[0].export?.id));
    equal((await repo.listExports()).length, 1);
    await rejects(
      () => workflow.patch(m.id, { personalNotes: "Changed after saving" }),
      "read-only",
    );
  } finally {
    await close();
  }
});

Deno.test("notes failure can retry without transcribing the audio twice", async () => {
  let transcriptions = 0;
  let summaries = 0;
  const mock = new MockProvider(0);
  const { repo, workflow, close } = fixture({
    transcribe: async (meeting, submitted) => {
      transcriptions++;
      await submitted("aai-job");
      return mock.transcribe(meeting);
    },
    summarize: async (transcript, meeting) => {
      if (++summaries === 1) throw new Error("Temporary notes failure");
      return mock.summarize(transcript, meeting);
    },
  });
  try {
    const m = await readyMeeting(workflow);
    equal(m.status, "failed");
    equal(m.transcriptId, "aai-job");
    assert(m.transcript);
    await workflow.retry(m.id);
    await workflow.idle();
    equal((await repo.getMeeting(m.id)).status, "ready");
    equal(transcriptions, 1);
    equal(summaries, 2);
    await rejects(() => workflow.retry(m.id), "Only failed");
  } finally {
    await close();
  }
});

Deno.test("processing is deduplicated and resumes a persisted transcript job after restart", async () => {
  const storage = await Deno.makeTempDir();
  const repo = new Repository(`${storage}/test.sqlite`);
  let calls = 0;
  const mock = new MockProvider(0);
  const original = new Workflow(repo, { mock, assemblyai: mock }, "mock");
  try {
    const meeting = await readyMeeting(original);
    await repo.update(
      meeting.id,
      (m) => ({
        ...m,
        status: "transcribing",
        transcript: "",
        transcriptId: "existing-job",
        notes: null,
      }),
    );
    const provider = {
      transcribe: (m: typeof meeting) => {
        calls++;
        equal(m.transcriptId, "existing-job");
        return mock.transcribe(m);
      },
      summarize: mock.summarize.bind(mock),
    };
    const resumed = new Workflow(
      repo,
      { mock: provider, assemblyai: provider },
      "mock",
    );
    await resumed.resume();
    await Promise.all([
      resumed.enqueue(meeting.id),
      resumed.enqueue(meeting.id),
    ]);
    await resumed.idle();
    equal(calls, 1);
    equal((await repo.getMeeting(meeting.id)).status, "ready");
  } finally {
    await repo.close();
    await Deno.remove(storage, { recursive: true });
  }
});

Deno.test("mock upload never invents transcript or notes for real audio", async () => {
  const { repo, workflow, close } = fixture();
  try {
    const m = await workflow.create({
      title: "Private recording",
      source: "upload",
      consent: true,
      audioPath: "/unused",
      duration: 120,
    });
    await workflow.idle();
    const ready = await repo.getMeeting(m.id);
    assert(ready.notes?.summary.includes("No audio content was analysed"));
    equal(ready.utterances, []);
    equal(ready.notes?.actions, []);
    assert(!ready.transcript.includes("Sarah"));
    equal(ready.duration, 120);
  } finally {
    await close();
  }
});

Deno.test("SQLite persists long transcripts, edits, and exports across repository reopen", async () => {
  const dir = await Deno.makeTempDir();
  const path = `${dir}/meet.sqlite`;
  let repo = new Repository(path);
  try {
    const mock = new MockProvider(0);
    const workflow = new Workflow(repo, { mock, assemblyai: mock }, "mock");
    const m = await readyMeeting(workflow);
    await repo.update(
      m.id,
      (meeting) => ({
        ...meeting,
        transcript: "Transcript content. ".repeat(10000),
      }),
    );
    await repo.createMatter({
      id: "matter",
      reference: "MAT-1",
      name: "Test",
      client: "Client",
    });
    await workflow.patch(m.id, { matterId: "matter" });
    await workflow.saveToMatter(m.id, true);
    await repo.close();
    repo = new Repository(path);
    equal((await repo.getMeeting(m.id)).transcript.length, 200000);
    equal((await repo.listExports()).length, 1);
  } finally {
    await repo.close();
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("time entry rounding handles exact and partial six-minute increments", () => {
  equal([0, 1, 359, 360, 361, 720, 721].map(billableMinutes), [
    6,
    6,
    6,
    6,
    12,
    12,
    18,
  ]);
});
