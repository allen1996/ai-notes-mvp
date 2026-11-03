import { createHandler } from "@server/routes/api.ts";
import { AppError } from "@server/utils/errors.ts";
import { Repository } from "@server/tables/repository.ts";
import { Workspaces } from "@server/operations/workspaces.ts";
import { MockProvider } from "@server/infra/mock-note-provider.ts";
import { assert, equal } from "@server/utils/test-helpers.ts";

async function apiFixture() {
  const dir = await Deno.makeTempDir();
  await Deno.writeTextFile(
    `${dir}/index.html`,
    "<html>Public sign-in page</html>",
  );
  const root = new Repository(`${dir}/test.sqlite`);
  const mock = new MockProvider(0);
  const workspaces = new Workspaces(
    root,
    { mock, assemblyai: mock },
    "mock",
    false,
  );
  const handler = createHandler({
    audioDir: dir,
    distDir: dir,
    aiProvider: "mock",
    getWorkspace: (id) => workspaces.get(id),
    authenticate: async (request) => {
      const token = request.headers.get("authorization");
      if (token === "Bearer alice") {
        return { userId: "user_alice", sessionId: "sess_alice" };
      }
      if (token === "Bearer bob") {
        return { userId: "user_bob", sessionId: "sess_bob" };
      }
      throw new AppError(401, "Sign in to access your workspace.");
    },
  });
  const call = (path: string, user?: string, method = "GET", body?: unknown) =>
    handler(
      new Request(`http://127.0.0.1:8787${path}`, {
        method,
        headers: {
          ...(user ? { authorization: `Bearer ${user}` } : {}),
          "content-type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
  return {
    dir,
    handler,
    call,
    workspaces,
    close: async () => {
      await workspaces.idle();
      await root.close();
      await Deno.remove(dir, { recursive: true });
    },
  };
}

Deno.test("every data route requires a session; static login assets and health are public", async () => {
  const { call, close } = await apiFixture();
  try {
    for (
      const [path, method] of [
        ["/api/config", "GET"],
        ["/api/usage", "GET"],
        ["/api/meetings/id", "DELETE"],
        ["/api/meetings", "GET"],
        ["/api/meetings", "POST"],
        ["/api/matters", "GET"],
        ["/api/matters", "POST"],
        ["/api/meetings/id", "GET"],
        ["/api/meetings/id", "PATCH"],
        ["/api/meetings/id/retry", "POST"],
        ["/api/meetings/id/save", "POST"],
        ["/api/meetings/id/audio", "GET"],
      ]
    ) {
      const response = await call(path, undefined, method);
      equal(response.status, 401);
      equal(response.headers.get("cache-control"), "no-store");
    }
    equal((await call("/api/health")).status, 200);
    const page = await call("/");
    equal(page.status, 200);
    assert((await page.text()).includes("Public sign-in"));
    equal((await call("/api/meetings", "expired")).status, 401);
  } finally {
    await close();
  }
});

Deno.test("HTTP user isolation: read, edit, retry, save, audio, lists, and spoofed user IDs", async () => {
  const { call, handler, dir, workspaces, close } = await apiFixture();
  try {
    const form = new FormData();
    form.append(
      "audio",
      new File([new Uint8Array([1, 2, 3])], "audio.webm", {
        type: "audio/webm",
      }),
    );
    form.append("title", "Alice private audio");
    form.append("consent", "true");
    form.append("source", "upload");
    form.append("userId", "user_bob");
    const created = await handler(
      new Request("http://127.0.0.1:8787/api/meetings", {
        method: "POST",
        headers: { authorization: "Bearer alice" },
        body: form,
      }),
    );
    equal(created.status, 202);
    const meeting = await created.json();
    await workspaces.idle();
    equal((await (await call("/api/meetings", "alice")).json()).length, 1);
    equal(
      await (await call("/api/meetings?userId=user_alice", "bob")).json(),
      [],
    );
    for (
      const [suffix, method, body] of [
        ["", "GET", undefined],
        ["", "DELETE", { confirmed: true }],
        ["", "PATCH", { title: "Stolen" }],
        ["/retry", "POST", undefined],
        ["/save", "POST", { reviewed: true }],
        ["/audio", "GET", undefined],
      ] as const
    ) {
      equal(
        (await call(
          `/api/meetings/${meeting.id}${suffix}`,
          "bob",
          method,
          body,
        )).status,
        404,
      );
    }
    const audio = await call(`/api/meetings/${meeting.id}/audio`, "alice");
    equal(audio.status, 200);
    equal([...new Uint8Array(await audio.arrayBuffer())], [1, 2, 3]);
    const matter = await (await call("/api/matters", "alice", "POST", {
      name: "Alice case",
      client: "Alice",
      reference: "REF-1",
      ownerId: "user_bob",
    })).json();
    equal(await (await call("/api/matters", "bob")).json(), []);
    equal(
      (await call(`/api/meetings/${meeting.id}`, "alice", "PATCH", {
        matterId: matter.id,
      })).status,
      200,
    );
    equal(
      (await call(`/api/meetings/${meeting.id}/save`, "alice", "POST", {
        reviewed: true,
      })).status,
      200,
    );
    // Cookie-only media URLs cannot bypass bearer authentication after logout.
    equal(
      (await handler(
        new Request(`http://127.0.0.1:8787/api/meetings/${meeting.id}/audio`, {
          headers: { cookie: "__session=alice" },
        }),
      )).status,
      401,
    );
    equal(
      (await call("/api/matters", "bob", "POST", {
        name: "Bob case",
        client: "Bob",
        reference: "REF-1",
      })).status,
      201,
    );
    assert(dir);
  } finally {
    await close();
  }
});
