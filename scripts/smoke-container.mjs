import { execFileSync } from "node:child_process";
import { request } from "node:http";
import assert from "node:assert/strict";

// Self-contained Docker smoke test: dummy Clerk keys, isolated disposable volume.
const name = `meet-smoke-${process.pid}-${Date.now()}`;
const volume = `${name}-data`;
const image = process.argv[2] ?? "meet-mvp:railway-test";
const docker = (...args) =>
  execFileSync("docker", args, { encoding: "utf8" }).trim();
let port;
const call = (path, host = "meet.example.test", origin) =>
  new Promise((resolve, reject) => {
    const req = request({
      hostname: "127.0.0.1",
      port,
      path,
      headers: { host, ...(origin ? { origin } : {}) },
      timeout: 3000,
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => body += chunk);
      response.on("end", () => resolve({ status: response.statusCode, body }));
    });
    req.on("timeout", () => req.destroy(new Error("HTTP timeout")));
    req.on("error", reject);
    req.end();
  });
async function ready() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      if (
        (await call("/api/health", "healthcheck.railway.app")).status === 200
      ) return;
    } catch { /* Wait for startup. */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Container did not become healthy.");
}
try {
  docker("volume", "create", volume);
  docker(
    "run",
    "--detach",
    "--name",
    name,
    "--publish",
    "127.0.0.1::8787",
    "--mount",
    `type=volume,source=${volume},target=/data`,
    "--env",
    "APP_ORIGIN=https://meet.example.test",
    "--env",
    "RAILWAY_ENVIRONMENT_ID=smoke",
    "--env",
    "RAILWAY_VOLUME_MOUNT_PATH=/data",
    "--env",
    "VITE_CLERK_PUBLISHABLE_KEY=pk_test_dGVzdC5jbGVyay5hY2NvdW50cy5kZXYk",
    "--env",
    "CLERK_SECRET_KEY=sk_test_container_dummy",
    "--env",
    "SEED_DEMO=false",
    image,
  );
  port = Number(docker("port", name, "8787/tcp").split(":").at(-1));
  await ready();
  const page = await call("/");
  assert.equal(page.status, 200);
  const asset = page.body.match(/src="([^"]+\.js)"/)?.[1];
  assert.ok(asset, "React bundle is referenced by index.html");
  assert.equal((await call(asset)).status, 200);
  assert.equal((await call("/api/meetings")).status, 401);
  assert.equal(
    (await call(
      "/api/meetings",
      "meet.example.test",
      "https://attacker.example",
    )).status,
    403,
  );
  assert.equal((await call("/", "attacker.example")).status, 403);
  assert.equal((await call("/.env")).status, 404);
  docker(
    "exec",
    name,
    "deno",
    "eval",
    `
    import { Repository } from "./server/tables/repository.ts";
    const root = new Repository("/data/meet.sqlite");
    await root.forUser("smoke").setMeta("restart-marker", "persisted");
    await root.close();
  `,
  );
  docker("restart", "--time", "15", name);
  // Docker can assign a new ephemeral host port when restarting the container.
  port = Number(docker("port", name, "8787/tcp").split(":").at(-1));
  await ready();
  docker(
    "exec",
    name,
    "deno",
    "eval",
    `
    import { Repository } from "./server/tables/repository.ts";
    const root = new Repository("/data/meet.sqlite");
    if (await root.forUser("smoke").getMeta("restart-marker") !== "persisted") {
      throw new Error("Prisma SQLite data was lost on restart");
    }
    await root.close();
  `,
  );
  console.log(
    "Container smoke passed: React assets, Railway health host, auth/origin checks, and SQLite persistence after restart.",
  );
} catch (error) {
  try {
    console.error(docker("logs", name));
  } catch { /* Container may not exist. */ }
  throw error;
} finally {
  try {
    docker("rm", "--force", name);
  } catch { /* Best effort cleanup. */ }
  try {
    docker("volume", "rm", volume);
  } catch { /* Best effort cleanup. */ }
}
