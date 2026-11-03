import { ApiError, createApi } from "@client/lib/api.ts";
import { assert, equal } from "@lib/testing/assert.ts";

Deno.test("frontend client obtains a fresh token for JSON, multipart, and private audio requests", async () => {
  let tokens = 0;
  const paths: string[] = [];
  const api = createApi(
    async () => `token-${++tokens}`,
    async (input, init) => {
      const headers = new Headers(init?.headers);
      equal(headers.get("authorization"), `Bearer token-${tokens}`);
      equal(init?.credentials, "omit");
      equal(init?.cache, "no-store");
      paths.push(String(input));
      if (String(input).endsWith("/audio")) {
        return new Response(new Uint8Array([1, 2]), {
          headers: { "content-type": "audio/webm" },
        });
      }
      if (init?.body instanceof FormData) {
        equal(
          headers.get("content-type"),
          null,
        );
      } else if (init?.body) {
        equal(
          headers.get("content-type"),
          "application/json",
        );
      }
      return Response.json({ id: "meeting" });
    },
  );
  await api.createDemo("Test", true);
  await api.upload(new FormData());
  const audio = await api.audio("meeting", new AbortController().signal);
  equal(audio.type, "audio/webm");
  equal([...new Uint8Array(await audio.arrayBuffer())], [1, 2]);
  equal(tokens, 3);
  assert(paths.every((p) => !p.includes("token")));
});

Deno.test("frontend never calls the API when Clerk has no token and preserves server auth errors", async () => {
  let requests = 0;
  const noToken = createApi(async () => null, async () => {
    requests++;
    return Response.json([]);
  });
  try {
    await noToken.meetings();
    throw new Error("Expected auth error");
  } catch (error) {
    assert(error instanceof ApiError);
    equal(error.status, 401);
  }
  equal(requests, 0);
  const denied = createApi(
    async () => "expired",
    async () => Response.json({ error: "Session expired" }, { status: 401 }),
  );
  try {
    await denied.meetings();
    throw new Error("Expected auth error");
  } catch (error) {
    assert(error instanceof ApiError);
    equal(error.status, 401);
    equal(error.message, "Session expired");
  }
});

Deno.test("frontend confirms deletion explicitly and preserves quota errors for upgrade navigation", async () => {
  const api = createApi(async () => "session", async (path, init) => {
    equal(new Headers(init?.headers).get("authorization"), "Bearer session");
    if (init?.method === "DELETE") {
      equal(String(path), "/api/meetings/meeting%2Fid");
      equal(JSON.parse(String(init.body)), { confirmed: true });
      return Response.json({ deleted: true });
    }
    return Response.json({
      error: "Upgrade required",
      code: "AI_QUOTA_EXHAUSTED",
    }, { status: 402 });
  });
  equal(await api.deleteMeeting("meeting/id"), { deleted: true });
  try {
    await api.upload(new FormData());
    throw new Error("Expected quota rejection");
  } catch (error) {
    assert(error instanceof ApiError);
    equal(error.status, 402);
    equal(error.code, "AI_QUOTA_EXHAUSTED");
  }
});
