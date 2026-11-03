import { createHandler, MAX_UPLOAD_BYTES } from "@server/routes/api.ts";
import type { Workflow } from "@server/operations/meeting-workflow.ts";
import { assert, equal, fixture } from "@server/utils/test-helpers.ts";

Deno.test("HTTP workflow: demo capture, edit, matter save, audio absence, and safe public fields", async () => {
  const { repo, workflow, close } = fixture();
  const handle = testHandler(workflow, "/unused");
  const call = (path: string, method = "GET", body?: unknown) =>
    handle(
      new Request(`http://127.0.0.1:8787/api${path}`, {
        method,
        headers: { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
  try {
    const created = await call("/meetings", "POST", {
      title: "Test",
      source: "demo",
      consent: true,
    });
    equal(created.status, 202);
    const m = await created.json();
    await workflow.idle();
    const list = await (await call("/meetings")).json();
    equal(list.length, 1);
    equal(list[0].status, "ready");
    assert(!("audioPath" in list[0]));
    const matter = await (await call("/matters", "POST", {
      name: "Purchase",
      client: "Client",
      reference: "REF-1",
    })).json();
    equal(
      (await call(`/meetings/${m.id}`, "PATCH", { matterId: matter.id }))
        .status,
      200,
    );
    equal(
      (await call(`/meetings/${m.id}/save`, "POST", { reviewed: true })).status,
      200,
    );
    equal((await repo.listExports()).length, 1);
    equal((await call(`/meetings/${m.id}/audio`)).status, 404);
    equal((await call("/meetings/missing")).status, 404);
  } finally {
    await close();
  }
});

Deno.test("HTTP multipart upload stores playable bytes and mock output is labelled", async () => {
  const { workflow, close } = fixture();
  const dir = await Deno.makeTempDir();
  const handle = testHandler(workflow, dir);
  try {
    const form = new FormData();
    form.append(
      "audio",
      new File([new Uint8Array([1, 2, 3, 4])], "recording.webm", {
        type: "audio/webm",
      }),
    );
    form.append("title", "Recorded meeting");
    form.append("consent", "true");
    form.append("source", "microphone");
    form.append("duration", "4");
    const response = await handle(
      new Request("http://127.0.0.1:8787/api/meetings", {
        method: "POST",
        body: form,
      }),
    );
    equal(response.status, 202);
    const meeting = await response.json();
    assert(!("audioPath" in meeting));
    await workflow.idle();
    const audio = await handle(
      new Request(`http://127.0.0.1:8787/api/meetings/${meeting.id}/audio`),
    );
    equal(audio.status, 200);
    equal(audio.headers.get("content-type"), "audio/webm");
    equal([...new Uint8Array(await audio.arrayBuffer())], [1, 2, 3, 4]);
    assert(
      (await workflow.repo.getMeeting(meeting.id)).notes?.summary.includes(
        "mock result",
      ),
    );
  } finally {
    await close();
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("HTTP rejects missing consent, malformed input, oversized uploads, and foreign origins", async () => {
  const { workflow, close } = fixture();
  const handle = testHandler(workflow, "/unused");
  const url = "http://127.0.0.1:8787/api/meetings";
  try {
    equal(
      (await handle(
        new Request(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{broken",
        }),
      )).status,
      400,
    );
    equal(
      (await handle(
        new Request(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: "Test", source: "demo" }),
        }),
      )).status,
      400,
    );
    equal(
      (await handle(
        new Request(url, {
          method: "POST",
          headers: {
            "content-type": "multipart/form-data",
            "content-length": String(MAX_UPLOAD_BYTES + 100000),
          },
          body: "small",
        }),
      )).status,
      413,
    );
    equal(
      (await handle(
        new Request(url, { headers: { origin: "https://foreign.example" } }),
      )).status,
      403,
    );
    equal(
      (await handle(
        new Request(url, { headers: { origin: "http://127.0.0.1:5173" } }),
      )).status,
      200,
    );
    equal(
      (await handle(
        new Request(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "[]",
        }),
      )).status,
      400,
    );
    equal(
      (await handle(new Request("http://foreign.example:8787/api/meetings")))
        .status,
      403,
    );
  } finally {
    await close();
  }
});

Deno.test("HTTP rejects unsupported files and duplicate matter references", async () => {
  const { workflow, close } = fixture();
  const handle = testHandler(workflow, "/unused");
  try {
    const form = new FormData();
    form.append(
      "audio",
      new File(["script"], "evil.html", { type: "text/html" }),
    );
    equal(
      (await handle(
        new Request("http://127.0.0.1:8787/api/meetings", {
          method: "POST",
          body: form,
        }),
      )).status,
      415,
    );
    const matterRequest = (reference: string) =>
      new Request("http://127.0.0.1:8787/api/matters", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Case", client: "Client", reference }),
      });
    equal((await handle(matterRequest("REF-1"))).status, 201);
    equal((await handle(matterRequest("ref-1"))).status, 409);
  } finally {
    await close();
  }
});

function testHandler(workflow: Workflow, audioDir: string) {
  return createHandler({
    audioDir,
    aiProvider: "mock",
    getWorkspace: async () => workflow,
    authenticate: async () => ({ userId: "user_test", sessionId: "sess_test" }),
  });
}

Deno.test("Zod rejects invalid write payloads and strips protected meeting fields", async () => {
  const { workflow, repo, close } = fixture();
  const handle = testHandler(workflow, "/unused");
  const call = (path: string, method: string, body: unknown) =>
    handle(
      new Request(`http://127.0.0.1:8787/api${path}`, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  try {
    for (
      const body of [
        { title: "Test", source: "demo", consent: "true" },
        { title: " ", source: "demo", consent: true },
        { title: "Test", source: "upload", consent: true },
      ]
    ) equal((await call("/meetings", "POST", body)).status, 400);
    equal(await repo.listMeetings(), []);
    equal(
      (await call("/matters", "POST", {
        name: "Matter",
        client: {},
        reference: "REF",
      })).status,
      400,
    );
    equal(await repo.listMatters(), []);
    const created = await (await call("/meetings", "POST", {
      title: "Original",
      source: "demo",
      consent: true,
    })).json();
    await workflow.idle();
    for (
      const patch of [
        { title: [] },
        { personalNotes: "x".repeat(20001) },
        { matterId: 42 },
        {
          notes: {
            summary: "Bad",
            keyPoints: [],
            actions: [{ text: "Do it", owner: {}, done: false }],
          },
        },
      ]
    ) {
      equal(
        (await call(`/meetings/${created.id}`, "PATCH", patch)).status,
        400,
      );
    }
    equal((await repo.getMeeting(created.id)).title, "Original");
    equal(
      (await call(`/meetings/${created.id}/save`, "POST", { reviewed: "true" }))
        .status,
      400,
    );
    equal(
      (await call(`/meetings/${created.id}`, "PATCH", {
        title: "  Reviewed  ",
        status: "saved",
        provider: "assemblyai",
        audioPath: "/etc/passwd",
        ownerId: "bob",
      })).status,
      200,
    );
    const meeting = await repo.getMeeting(created.id);
    equal(meeting.title, "Reviewed");
    equal(meeting.status, "ready");
    equal(meeting.provider, "mock");
    assert(!meeting.audioPath);
    equal(await repo.listExports(), []);
  } finally {
    await close();
  }
});

Deno.test("Zod validates multipart metadata before persisting recording bytes", async () => {
  const { workflow, repo, close } = fixture();
  const dir = await Deno.makeTempDir();
  const handle = testHandler(workflow, dir);
  try {
    for (
      const values of [
        { duration: "NaN", consent: "true", source: "upload" },
        { duration: "-1", consent: "true", source: "upload" },
        { duration: "36001", consent: "true", source: "upload" },
        { duration: "1", consent: "false", source: "upload" },
        { duration: "1", consent: "true", source: "demo" },
      ]
    ) {
      const form = new FormData();
      form.append(
        "audio",
        new File(["bytes"], "recording.webm", { type: "audio/webm" }),
      );
      form.append("title", "Recording");
      for (const [name, value] of Object.entries(values)) {
        form.append(name, value);
      }
      equal(
        (await handle(
          new Request("http://127.0.0.1:8787/api/meetings", {
            method: "POST",
            body: form,
          }),
        )).status,
        400,
      );
    }
    equal(await repo.listMeetings(), []);
    equal(Array.from(Deno.readDirSync(dir)).length, 0);
  } finally {
    await close();
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("HTTP quota blocks recording storage before upload while examples remain available", async () => {
  const { repo, workflow, close } = fixture();
  const dir = await Deno.makeTempDir();
  const handle = testHandler(workflow, dir);
  try {
    for (let i = 0; i < 3; i++) {
      await workflow.create({
        title: "Used credit",
        source: "upload",
        consent: true,
        audioPath: "/unused",
      });
    }
    await workflow.idle();
    const form = new FormData();
    form.append(
      "audio",
      new File(["bytes"], "recording.webm", { type: "audio/webm" }),
    );
    form.append("title", "Fourth recording");
    form.append("source", "upload");
    form.append("consent", "true");
    const response = await handle(
      new Request("http://127.0.0.1:8787/api/meetings", {
        method: "POST",
        body: form,
      }),
    );
    equal(response.status, 402);
    equal((await response.json()).code, "AI_QUOTA_EXHAUSTED");
    equal(Array.from(Deno.readDirSync(dir)).length, 0);
    equal((await repo.listMeetings()).length, 3);
    const example = await handle(
      new Request("http://127.0.0.1:8787/api/meetings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Still free",
          source: "demo",
          consent: true,
        }),
      }),
    );
    equal(example.status, 202);
    await workflow.idle();
    equal((await repo.getUsage()).used, 3);
  } finally {
    await close();
    await Deno.remove(dir, { recursive: true });
  }
});
