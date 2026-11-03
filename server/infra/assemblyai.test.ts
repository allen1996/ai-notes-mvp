import { AssemblyAIProvider } from "@server/infra/assemblyai.ts";
import { validateNotes } from "@server/models/notes.ts";
import type { Meeting } from "@lib/types/meeting.ts";
import { assert, equal, rejects } from "@server/utils/test-helpers.ts";

const meeting = {
  source: "upload",
  audioPath: "/audio",
  duration: 5,
} as Meeting;
const notes = {
  summary: "Client agreed to send the draft.",
  keyPoints: ["Draft outstanding"],
  actions: [{ text: "Send draft", owner: "Speaker B" }],
};

Deno.test("AssemblyAI REST contract: binary upload, speaker labels, poll, then LLM Gateway notes", async () => {
  const calls: { url: string; body: unknown }[] = [];
  let polls = 0;
  let submitted = "";
  const http: typeof fetch = async (input, init) => {
    const url = String(input);
    equal(new Headers(init?.headers).get("authorization"), "test-key");
    calls.push({ url, body: init?.body });
    if (url.endsWith("/upload")) {
      assert(init?.body instanceof Uint8Array);
      equal(
        new Headers(init.headers).get("content-type"),
        "application/octet-stream",
      );
      return Response.json({ upload_url: "https://uploaded.example/audio" });
    }
    if (url.endsWith("/transcript")) {
      const payload = JSON.parse(init?.body as string);
      equal(payload.speaker_labels, true);
      equal(payload.speech_models, ["universal-3-5-pro", "universal-2"]);
      assert(!("summarization" in payload));
      return Response.json({ id: "job-1" });
    }
    if (url.includes("/transcript/")) {
      return Response.json(
        ++polls < 2 ? { status: "processing" } : {
          status: "completed",
          text: "Send the draft.",
          audio_duration: 42,
          utterances: [{
            speaker: "B",
            start: 0,
            end: 1000,
            text: "Send the draft.",
          }],
        },
      );
    }
    const payload = JSON.parse(init?.body as string);
    equal(payload.model, "test-model");
    assert(payload.messages[1].content.includes("Speaker B: Send the draft."));
    assert(payload.messages[0].content.includes("Do not invent"));
    return Response.json({
      choices: [{ message: { content: JSON.stringify(notes) } }],
    });
  };
  const provider = new AssemblyAIProvider(
    "test-key",
    "test-model",
    http,
    0,
    async () => new Uint8Array([1, 2]),
  );
  const transcript = await provider.transcribe(meeting, async (id) => {
    submitted = id;
  });
  equal(submitted, "job-1");
  equal(transcript.duration, 42);
  equal(polls, 2);
  const result = await provider.summarize(transcript);
  equal(result.summary, notes.summary);
  assert(result.actions[0].id);
  equal(result.actions[0].done, false);
  equal(
    calls.at(-1)?.url,
    "https://llm-gateway.assemblyai.com/v1/chat/completions",
  );
});

Deno.test("AssemblyAI resumes existing job without another upload or submit", async () => {
  let calls = 0;
  const provider = new AssemblyAIProvider("key", undefined, async (url) => {
    calls++;
    assert(String(url).endsWith("/existing"));
    return Response.json({
      status: "completed",
      text: "Hello",
      audio_duration: 1,
    });
  }, 0);
  const result = await provider.transcribe({
    ...meeting,
    transcriptId: "existing",
  }, async () => {
    throw new Error("Should not submit");
  });
  equal(result.text, "Hello");
  equal(calls, 1);
});

Deno.test("AssemblyAI authentication errors do not expose credentials or vendor response bodies", async () => {
  const provider = new AssemblyAIProvider(
    "secret-test-key",
    undefined,
    async () =>
      new Response("secret response with transcript", { status: 401 }),
  );
  await rejects(
    () =>
      provider.transcribe(
        { ...meeting, transcriptId: "existing" },
        async () => {},
      ),
    "AssemblyAI request failed (401)",
  );
});

Deno.test("AssemblyAI rejects no-speech audio and malformed note output", async () => {
  const provider = new AssemblyAIProvider(
    "key",
    undefined,
    async () => Response.json({ status: "completed", text: "" }),
  );
  await rejects(
    () =>
      provider.transcribe(
        { ...meeting, transcriptId: "existing" },
        async () => {},
      ),
    "No speech",
  );
  const broken = new AssemblyAIProvider(
    "key",
    undefined,
    async () =>
      Response.json({ choices: [{ message: { content: "not JSON" } }] }),
  );
  await rejects(
    () => broken.summarize({ text: "Hello", utterances: [], duration: 1 }),
    "invalid notes",
  );
  await rejects(
    async () =>
      validateNotes({
        summary: "OK",
        keyPoints: ["OK"],
        actions: [{ text: 7, owner: "A" }],
      }),
    "invalid format",
  );
});

Deno.test("AssemblyAI cancellation stops active polling and prevents later paid requests", async () => {
  const controller = new AbortController();
  let requests = 0;
  const provider = new AssemblyAIProvider(
    "test-key",
    "test-model",
    (_input, init) => {
      requests++;
      assert(init?.signal);
      return new Promise((_resolve, reject) => {
        init.signal!.addEventListener(
          "abort",
          () => reject(init.signal!.reason),
          { once: true },
        );
      });
    },
    0,
  );
  const pending = provider.transcribe(
    { ...meeting, transcriptId: "existing" },
    () => Promise.resolve(),
    controller.signal,
  );
  controller.abort(new Error("Meeting deleted"));
  await rejects(() => pending, "Meeting deleted");
  equal(requests, 1);
  await rejects(
    () =>
      provider.summarize(
        { text: "Text", utterances: [], duration: 1 },
        meeting,
        controller.signal,
      ),
    "Meeting deleted",
  );
  equal(requests, 1);
});
