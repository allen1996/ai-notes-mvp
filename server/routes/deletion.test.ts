import { createHandler } from "@server/routes/api.ts";
import { Repository } from "@server/tables/repository.ts";
import { Workspaces } from "@server/operations/workspaces.ts";
import { Workflow } from "@server/operations/meeting-workflow.ts";
import {
  LocalAudioStorage,
  R2AudioStorage,
} from "@server/infra/audio-storage.ts";
import { MockProvider } from "@server/infra/mock-note-provider.ts";
import { AppError } from "@server/utils/errors.ts";
import { assert, equal, rejects } from "@server/utils/test-helpers.ts";

Deno.test("HTTP deletion requires consent and ownership, then removes audio, notes and exports without refunding quota", async () => {
  const dir = await Deno.makeTempDir();
  const root = new Repository(`${dir}/test.sqlite`);
  const mock = new MockProvider(0);
  const audio = new LocalAudioStorage(dir);
  const workspaces = new Workspaces(
    root,
    { mock, assemblyai: mock },
    "mock",
    false,
    audio,
  );
  const handle = createHandler({
    audioDir: dir,
    audioStorage: audio,
    aiProvider: "mock",
    getWorkspace: (id) => workspaces.get(id),
    authenticate: async (request) => {
      const token = request.headers.get("authorization");
      if (token === "Bearer alice" || token === "Bearer bob") {
        return { userId: token.slice(7), sessionId: "test" };
      }
      throw new AppError(401, "Sign in");
    },
  });
  const call = (
    path: string,
    user: string | null,
    method = "GET",
    body?: unknown,
  ) =>
    handle(
      new Request(`http://127.0.0.1:8787/api${path}`, {
        method,
        headers: {
          ...(user ? { authorization: `Bearer ${user}` } : {}),
          "content-type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
  try {
    const alice = await workspaces.get("alice");
    const reference = await audio.put(new Uint8Array([1, 2, 3]), "audio/webm");
    const meeting = await alice.create({
      title: "Delete me",
      source: "upload",
      consent: true,
      audioPath: reference,
    });
    await alice.idle();
    await alice.repo.createMatter({
      id: "matter",
      reference: "MAT-1",
      name: "Matter",
      client: "Client",
    });
    await alice.patch(meeting.id, { matterId: "matter" });
    await alice.saveToMatter(meeting.id, true);
    const path = `/meetings/${meeting.id}`;
    equal((await call(path, null, "DELETE", { confirmed: true })).status, 401);
    equal((await call(path, "bob", "DELETE", { confirmed: true })).status, 404);
    equal(
      (await call(path, "alice", "DELETE", { confirmed: false })).status,
      400,
    );
    equal([...await Deno.readFile(reference)], [1, 2, 3]);
    equal(
      (await call(path, "alice", "DELETE", { confirmed: true })).status,
      200,
    );
    await rejects(() => alice.repo.getMeeting(meeting.id), "not found");
    equal(await alice.repo.listExports(), []);
    await rejects(() => Deno.stat(reference), "No such file");
    equal(await (await call("/usage", "alice")).json(), {
      limit: 3,
      used: 1,
      remaining: 2,
    });
    equal(await (await call("/usage", "bob")).json(), {
      limit: 3,
      used: 0,
      remaining: 3,
    });
    equal((await call("/usage", null)).status, 401);
  } finally {
    await workspaces.idle();
    await root.close();
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("R2 deletion failure stays recoverable; startup retries cleanup and missing objects are idempotent", async () => {
  const dir = await Deno.makeTempDir();
  const path = `${dir}/test.sqlite`;
  let root = new Repository(path);
  const mock = new MockProvider(0);
  let available = false;
  let removes = 0;
  const audio = new R2AudioStorage({
    accountId: "a".repeat(32),
    bucket: "test-audio",
    accessKeyId: "test",
    secretAccessKey: "test",
  }, (input) => {
    assert(input instanceof Request);
    equal(input.method, "DELETE");
    assert(input.headers.get("authorization")?.startsWith("AWS4-HMAC-SHA256"));
    removes++;
    return Promise.resolve(
      new Response(null, { status: available ? 404 : 503 }),
    );
  });
  let workspaces = new Workspaces(
    root,
    { mock, assemblyai: mock },
    "mock",
    false,
    audio,
  );
  try {
    const alice = await workspaces.get("alice");
    const meeting = await alice.create({
      title: "R2 recording",
      source: "upload",
      consent: true,
      audioPath: `r2:audio/${crypto.randomUUID()}`,
    });
    await alice.idle();
    await rejects(() => alice.delete(meeting.id), "storage is unavailable");
    equal((await alice.repo.getMeeting(meeting.id)).status, "deleting");
    await rejects(() => alice.retry(meeting.id), "Only failed");
    await root.close();
    root = new Repository(path);
    available = true;
    workspaces = new Workspaces(
      root,
      { mock, assemblyai: mock },
      "mock",
      false,
      audio,
    );
    await workspaces.resume();
    await workspaces.idle();
    equal(await root.forUser("alice").listMeetings(), []);
    equal((await root.forUser("alice").getUsage()).used, 1);
    equal(removes, 2);
  } finally {
    await workspaces.idle();
    await root.close();
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("deleting during processing aborts the worker and late provider results cannot recreate the meeting", async () => {
  const dir = await Deno.makeTempDir();
  const root = new Repository(`${dir}/test.sqlite`);
  const mock = new MockProvider(0);
  let started!: () => void;
  const startedPromise = new Promise<void>((resolve) => started = resolve);
  let release!: (value: Awaited<ReturnType<typeof mock.transcribe>>) => void;
  let signal: AbortSignal | undefined;
  let summaries = 0;
  let removed = 0;
  const provider = {
    transcribe: (
      _meeting: unknown,
      _submitted: unknown,
      abort?: AbortSignal,
    ) => {
      signal = abort;
      started();
      return new Promise<Awaited<ReturnType<typeof mock.transcribe>>>((
        resolve,
      ) => release = resolve);
    },
    summarize: () => {
      summaries++;
      return Promise.resolve({
        summary: "Late result",
        keyPoints: [],
        actions: [],
      });
    },
  };
  const workflow = new Workflow(
    root.forUser("alice"),
    { mock, assemblyai: provider },
    "assemblyai",
    {
      remove: () => {
        removed++;
        return Promise.resolve();
      },
    },
  );
  try {
    const meeting = await workflow.create({
      title: "Processing recording",
      source: "upload",
      consent: true,
      audioPath: "/test",
    });
    await startedPromise;
    await workflow.delete(meeting.id);
    assert(signal?.aborted);
    release({ text: "Late transcript", utterances: [], duration: 5 });
    await workflow.idle();
    equal(summaries, 0);
    equal(removed, 1);
    equal(await workflow.repo.listMeetings(), []);
    equal((await workflow.repo.getUsage()).used, 1);
  } finally {
    await workflow.idle();
    await root.close();
    await Deno.remove(dir, { recursive: true });
  }
});
