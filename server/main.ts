import { Repository } from "@server/tables/repository.ts";
import { Workspaces } from "@server/operations/workspaces.ts";
import { createClerkAuthenticator } from "@server/infra/auth.ts";
import { MockProvider } from "@server/infra/mock-note-provider.ts";
import { AssemblyAIProvider } from "@server/infra/assemblyai.ts";
import { createHandler } from "@server/routes/api.ts";
import { loadConfig } from "@server/infra/config.ts";
import {
  audioStorage,
  LocalAudioStorage,
  R2AudioStorage,
} from "@server/infra/audio-storage.ts";

const env = Deno.env.toObject();
const config = loadConfig(env);
const audioDir = `${config.dataDir}/audio`;
await Deno.mkdir(audioDir, { recursive: true });
const audio = audioStorage(
  new LocalAudioStorage(audioDir),
  config.audioStorage === "r2"
    ? new R2AudioStorage({
      accountId: env.R2_ACCOUNT_ID!,
      bucket: env.R2_BUCKET!,
      accessKeyId: env.R2_ACCESS_KEY_ID!,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
    })
    : undefined,
);
const repo = new Repository(`${config.dataDir}/meet.sqlite`);
await repo.connect();
const workspaces = new Workspaces(
  repo,
  {
    mock: new MockProvider(),
    assemblyai: new AssemblyAIProvider(
      env.ASSEMBLYAI_API_KEY ?? "",
      env.ASSEMBLYAI_LLM_MODEL,
      fetch,
      3000,
      (reference) => audio.read(reference),
    ),
  },
  config.aiProvider,
  config.seedDemo,
  audio,
);
await workspaces.resume();
const authenticate = createClerkAuthenticator({
  secretKey: env.CLERK_SECRET_KEY,
  publishableKey: env.VITE_CLERK_PUBLISHABLE_KEY,
  allowedOrigins: config.allowedOrigins,
});
const server = Deno.serve(
  {
    hostname: config.hostname,
    port: config.port,
    onListen: () =>
      console.log(
        `Meet listening on ${config.hostname}:${config.port} • AI: ${config.aiProvider} • audio: ${config.audioStorage} • legal software: mock`,
      ),
  },
  createHandler({
    audioDir,
    audioStorage: audio,
    distDir: "client/dist",
    authenticate,
    getWorkspace: (userId) => workspaces.get(userId),
    aiProvider: config.aiProvider,
    allowedOrigins: config.allowedOrigins,
  }),
);

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  // Finish active HTTP requests, then let persisted queued jobs resume on restart.
  setTimeout(() => Deno.exit(0), 10_000);
  await server.shutdown();
  await repo.close();
  Deno.exit(0);
}
Deno.addSignalListener("SIGTERM", shutdown);
Deno.addSignalListener("SIGINT", shutdown);
