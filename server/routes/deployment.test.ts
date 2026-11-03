import { createHandler } from "@server/routes/api.ts";
import { AppError } from "@server/utils/errors.ts";
import { Repository } from "@server/tables/repository.ts";
import { Workspaces } from "@server/operations/workspaces.ts";
import { MockProvider } from "@server/infra/mock-note-provider.ts";
import { assert, equal } from "@server/utils/test-helpers.ts";

Deno.test("hosted upload, notes, and private audio survive restart on the persistent data directory", async () => {
  const dir = await Deno.makeTempDir();
  await Deno.mkdir(`${dir}/audio`);
  await Deno.writeTextFile(`${dir}/index.html`, "<html>Meet sign-in</html>");
  const origin = "https://meet-demo.up.railway.app";
  const start = () => {
    const repo = new Repository(`${dir}/meet.sqlite`);
    const mock = new MockProvider(0);
    const workspaces = new Workspaces(
      repo,
      { mock, assemblyai: mock },
      "mock",
      false,
    );
    const handle = createHandler({
      audioDir: `${dir}/audio`,
      distDir: dir,
      allowedOrigins: [origin],
      aiProvider: "mock",
      getWorkspace: (userId) => workspaces.get(userId),
      authenticate: async (request) => {
        const token = request.headers.get("authorization");
        if (token === "Bearer alice" || token === "Bearer bob") {
          return { userId: token.slice(7), sessionId: "session" };
        }
        throw new AppError(401, "Sign in");
      },
    });
    return { repo, workspaces, handle };
  };
  let app = start();
  const call = (path: string, user?: string) =>
    app.handle(
      new Request(`${origin}${path}`, {
        headers: user ? { authorization: `Bearer ${user}`, origin } : {},
      }),
    );
  try {
    equal((await call("/")).status, 200);
    equal(
      (await app.handle(
        new Request("http://healthcheck.railway.app/api/health"),
      )).status,
      200,
    );
    equal((await call("/api/meetings")).status, 401);
    equal(
      (await app.handle(
        new Request(`${origin}/api/meetings`, {
          headers: { origin: "https://attacker.example" },
        }),
      )).status,
      403,
    );
    equal(
      (await app.handle(new Request("http://localhost:8787/api/meetings")))
        .status,
      403,
    );
    equal(
      (await app.handle(
        new Request("https://attacker.example/api/meetings", {
          headers: { "x-forwarded-host": "meet-demo.up.railway.app" },
        }),
      )).status,
      403,
    );
    const form = new FormData();
    form.append(
      "audio",
      new File([new Uint8Array([11, 22, 33])], "demo.webm", {
        type: "audio/webm",
      }),
    );
    form.append("title", "Hosted recording");
    form.append("consent", "true");
    form.append("source", "upload");
    const response = await app.handle(
      new Request(`${origin}/api/meetings`, {
        method: "POST",
        headers: { authorization: "Bearer alice", origin },
        body: form,
      }),
    );
    equal(response.status, 202);
    const meeting = await response.json();
    assert(!("audioPath" in meeting));
    await app.workspaces.idle();
    await app.repo.close();
    app = start();
    await app.workspaces.resume();
    const restored = await (await call(`/api/meetings/${meeting.id}`, "alice"))
      .json();
    equal(restored.status, "ready");
    assert(restored.notes.summary.includes("mock result"));
    const audioPath = `/api/meetings/${meeting.id}/audio`;
    const playback = await call(audioPath, "alice");
    equal(playback.status, 200);
    equal([...new Uint8Array(await playback.arrayBuffer())], [11, 22, 33]);
    equal((await call(audioPath, "bob")).status, 404);
    equal((await call(audioPath)).status, 401);
    equal(await (await call("/api/meetings", "bob")).json(), []);
  } finally {
    await app.workspaces.idle();
    await app.repo.close();
    await Deno.remove(dir, { recursive: true });
  }
});
