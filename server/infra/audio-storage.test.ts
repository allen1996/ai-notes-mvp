import {
  audioStorage,
  LocalAudioStorage,
  R2AudioStorage,
} from "@server/infra/audio-storage.ts";
import { assert, equal, rejects } from "@server/utils/test-helpers.ts";

const config = {
  accountId: "a".repeat(32),
  bucket: "meet-demo",
  accessKeyId: "test-access-key",
  secretAccessKey: "test-secret-key",
};

Deno.test("R2 uses signed private PUT/GET/DELETE and preserves existing volume audio", async () => {
  const objects = new Map<string, Uint8Array>();
  const methods: string[] = [];
  const http: typeof fetch = async (input) => {
    assert(input instanceof Request);
    const url = new URL(input.url);
    equal(url.hostname, `${config.accountId}.r2.cloudflarestorage.com`);
    assert(url.pathname.startsWith("/meet-demo/audio/"));
    equal(url.search, "");
    assert(input.headers.get("authorization")?.startsWith("AWS4-HMAC-SHA256 "));
    assert(
      input.headers.get("authorization")?.includes("/auto/s3/aws4_request"),
    );
    assert(input.headers.has("x-amz-content-sha256"));
    methods.push(input.method);
    if (input.method === "PUT") {
      equal(input.headers.get("content-type"), "audio/webm");
      objects.set(url.pathname, new Uint8Array(await input.arrayBuffer()));
      return new Response(null);
    }
    if (input.method === "DELETE") {
      objects.delete(url.pathname);
      return new Response(null, { status: 204 });
    }
    const bytes = objects.get(url.pathname);
    return bytes
      ? new Response(bytes as BodyInit)
      : new Response(null, { status: 404 });
  };
  const dir = await Deno.makeTempDir();
  try {
    const local = new LocalAudioStorage(dir);
    const legacy = await local.put(new Uint8Array([1, 2]), "audio/webm");
    const storage = audioStorage(local, new R2AudioStorage(config, http));
    const key = await storage.put(new Uint8Array([0, 128, 255]), "audio/webm");
    assert(key.startsWith("r2:audio/"));
    equal([...await storage.read(key)], [0, 128, 255]);
    equal([...await storage.read(legacy)], [1, 2]);
    await storage.remove(key);
    equal(methods, ["PUT", "GET", "DELETE"]);
    equal(objects.size, 0);
    await rejects(() => storage.read(key), "could not be found");
    await rejects(() => audioStorage(local).read(key), "Configure R2");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("R2 rejects arbitrary references and hides vendor bodies and network errors", async () => {
  const reference = `r2:audio/${crypto.randomUUID()}`;
  const failed = new R2AudioStorage(
    config,
    () =>
      Promise.resolve(new Response("sensitive vendor body", { status: 403 })),
  );
  await rejects(() => failed.read(reference), "Audio storage is unavailable");
  await rejects(
    () => failed.read("https://attacker.example/audio"),
    "Invalid audio storage reference",
  );
  const network = new R2AudioStorage(
    config,
    () => Promise.reject(new Error("sensitive credential details")),
  );
  await rejects(() => network.read(reference), "Audio storage is unavailable");
});
