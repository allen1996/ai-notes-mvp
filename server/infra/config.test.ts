import { loadConfig } from "@server/infra/config.ts";
import { LOCAL_ORIGINS } from "@server/infra/auth.ts";
import { assert, equal, rejects } from "@server/utils/test-helpers.ts";

const railway = {
  RAILWAY_ENVIRONMENT_ID: "environment_test",
  RAILWAY_PUBLIC_DOMAIN: "meet-demo.up.railway.app",
  RAILWAY_VOLUME_MOUNT_PATH: "/data",
  VITE_CLERK_PUBLISHABLE_KEY: "pk_test_config",
  CLERK_SECRET_KEY: "sk_test_config",
};

Deno.test("deployment config uses Railway port, public origin, and persistent volume", () => {
  const config = loadConfig({ ...railway, PORT: "4321" });
  equal(config.hostname, "0.0.0.0");
  equal(config.port, 4321);
  equal(config.allowedOrigins, ["https://meet-demo.up.railway.app"]);
  equal(config.dataDir, "/data");
  equal(config.audioStorage, "local");
  equal(
    loadConfig({ ...railway, APP_ORIGIN: "https://meet.example.com/" })
      .allowedOrigins,
    ["https://meet.example.com"],
  );
  const local = loadConfig({});
  equal(local.hostname, "127.0.0.1");
  equal(local.allowedOrigins, LOCAL_ORIGINS);
  assert(local.dataDir.endsWith("/.data"));
});

Deno.test("deployment config rejects missing persistence, invalid origins, ports, and incomplete credentials", async () => {
  for (const PORT of ["0", "65536", "hello", "80.5", ""]) {
    await rejects(async () => loadConfig({ PORT }), "PORT");
  }
  for (
    const APP_ORIGIN of [
      "http://meet.example.com",
      "https://meet.example.com/path",
      "https://user:pass@meet.example.com",
      "https://meet.example.com?x=1",
    ]
  ) {
    await rejects(
      async () => loadConfig({ ...railway, APP_ORIGIN }),
      "APP_ORIGIN",
    );
  }
  await rejects(
    async () =>
      loadConfig({ ...railway, RAILWAY_VOLUME_MOUNT_PATH: undefined }),
    "volume",
  );
  await rejects(
    async () => loadConfig({ ...railway, DATA_DIR: "/data-other" }),
    "inside",
  );
  await rejects(
    async () => loadConfig({ ...railway, DATA_DIR: "/tmp" }),
    "inside",
  );
  await rejects(
    async () => loadConfig({ ...railway, CLERK_SECRET_KEY: undefined }),
    "CLERK_SECRET_KEY",
  );
  await rejects(
    async () => loadConfig({ ...railway, RAILWAY_PUBLIC_DOMAIN: undefined }),
    "APP_ORIGIN",
  );
  await rejects(
    async () => loadConfig({ AI_PROVIDER: "assemblyai" }),
    "ASSEMBLYAI_API_KEY",
  );
  await rejects(
    async () => loadConfig({ AUDIO_STORAGE: "r2" }),
    "R2_ACCOUNT_ID",
  );
});
