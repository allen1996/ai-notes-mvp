import { relative, resolve, sep } from "node:path";
import { LOCAL_ORIGINS } from "@server/infra/auth.ts";

/** Parse configuration without reading global state so deployment rules are testable. */
export function loadConfig(env: Record<string, string | undefined>) {
  const railway = Boolean(env.RAILWAY_ENVIRONMENT_ID);
  const production = env.NODE_ENV === "production" || railway;
  const portText = env.PORT ?? "8787";
  const port = Number(portText);
  if (!/^\d+$/.test(portText) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }

  const originText = env.APP_ORIGIN ||
    (production && env.RAILWAY_PUBLIC_DOMAIN
      ? `https://${env.RAILWAY_PUBLIC_DOMAIN}`
      : undefined);
  let appOrigin: string | undefined;
  if (originText) {
    const url = new URL(originText);
    if (
      !["https:", "http:"].includes(url.protocol) || url.username ||
      url.password || url.pathname !== "/" || url.search || url.hash ||
      (production && url.protocol !== "https:")
    ) {
      throw new Error(
        "APP_ORIGIN must be an HTTPS origin without a path in production.",
      );
    }
    appOrigin = url.origin;
  }
  if (production && !appOrigin) {
    throw new Error(
      "Set APP_ORIGIN to your public HTTPS URL, or generate a Railway domain.",
    );
  }
  if (
    production && (!env.CLERK_SECRET_KEY || !env.VITE_CLERK_PUBLISHABLE_KEY)
  ) {
    throw new Error(
      "Set matching VITE_CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY before deploying.",
    );
  }

  const mount = env.RAILWAY_VOLUME_MOUNT_PATH;
  if (railway && !mount) {
    throw new Error(
      "Attach a Railway volume at /data before deploying; SQLite requires persistent storage.",
    );
  }
  const dataDir = resolve(env.DATA_DIR || mount || ".data");
  if (mount) {
    const path = relative(resolve(mount), dataDir);
    if (
      path === ".." || path.startsWith(`..${sep}`) ||
      resolve(mount, path) !== dataDir
    ) {
      throw new Error("DATA_DIR must be inside the attached Railway volume.");
    }
  }

  const aiProvider = env.AI_PROVIDER ?? "mock";
  if (aiProvider !== "mock" && aiProvider !== "assemblyai") {
    throw new Error("AI_PROVIDER must be mock or assemblyai.");
  }
  if (aiProvider === "assemblyai" && !env.ASSEMBLYAI_API_KEY) {
    throw new Error("Set ASSEMBLYAI_API_KEY before enabling AssemblyAI.");
  }
  const audioStorage = env.AUDIO_STORAGE ?? "local";
  if (audioStorage !== "local" && audioStorage !== "r2") {
    throw new Error("AUDIO_STORAGE must be local or r2.");
  }
  if (audioStorage === "r2") {
    for (
      const name of [
        "R2_ACCOUNT_ID",
        "R2_BUCKET",
        "R2_ACCESS_KEY_ID",
        "R2_SECRET_ACCESS_KEY",
      ]
    ) {
      if (!env[name]) {
        throw new Error(`Set ${name} before enabling R2 audio storage.`);
      }
    }
    if (!/^[a-f0-9]{32}$/.test(env.R2_ACCOUNT_ID!)) {
      throw new Error(
        "R2_ACCOUNT_ID must be your 32-character Cloudflare account ID.",
      );
    }
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(env.R2_BUCKET!)) {
      throw new Error("R2_BUCKET must be a valid bucket name.");
    }
  }

  return {
    production,
    hostname: production ? "0.0.0.0" : "127.0.0.1",
    port,
    dataDir,
    allowedOrigins: appOrigin ? [appOrigin] : LOCAL_ORIGINS,
    aiProvider,
    audioStorage,
    seedDemo: env.SEED_DEMO !== "false",
  } as const;
}
