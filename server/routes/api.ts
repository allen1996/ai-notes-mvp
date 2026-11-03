import type { AppConfig, Meeting } from "@lib/types/meeting.ts";
import { AppError } from "@server/utils/errors.ts";
import { Workflow } from "@server/operations/meeting-workflow.ts";
import type { Authenticate } from "@server/infra/auth.ts";
import { LOCAL_ORIGINS } from "@server/infra/auth.ts";
import {
  type AudioStorage,
  LocalAudioStorage,
} from "@server/infra/audio-storage.ts";

import {
  CreateMatterSchema,
  DeleteMeetingSchema,
  DemoMeetingSchema,
  MAX_UPLOAD_BYTES,
  MeetingIdSchema,
  parseInput,
  SaveMeetingSchema,
  UploadMeetingSchema,
  validateAudioFile,
} from "@server/models/inputs.ts";
export { MAX_UPLOAD_BYTES } from "@server/models/inputs.ts";
const MAX_BODY_BYTES = MAX_UPLOAD_BYTES + 64 * 1024;
const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "cache-control": "no-store" } });
const publicMeeting = ({ audioPath: _path, ...meeting }: Meeting) => meeting;

/** Bound request bodies before multipart/JSON parsing to avoid unbounded buffering. */
async function boundedBody(
  request: Request,
  limit: number,
): Promise<Uint8Array> {
  if (Number(request.headers.get("content-length")) > limit) {
    throw new AppError(413, "Recording is too large. Maximum upload is 50 MB.");
  }
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new AppError(
        413,
        "Request is too large. Maximum recording size is 50 MB.",
      );
    }
    chunks.push(value);
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}
async function bodyJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const data = JSON.parse(
      new TextDecoder().decode(await boundedBody(request, 128 * 1024)),
    );
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error();
    }
    return data;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(400, "Request must contain a JSON object.");
  }
}

export function createHandler(
  options: {
    audioDir: string;
    audioStorage?: AudioStorage;
    distDir?: string;
    authenticate: Authenticate;
    getWorkspace: (userId: string) => Promise<Workflow>;
    aiProvider: AppConfig["aiProvider"];
    allowedOrigins?: string[];
  },
) {
  const allowedOrigins = options.allowedOrigins ?? LOCAL_ORIGINS;
  const allowedHosts = new Set(
    allowedOrigins.map((origin) => new URL(origin).host),
  );
  const audio = options.audioStorage ?? new LocalAudioStorage(options.audioDir);
  const config: AppConfig = {
    aiProvider: options.aiProvider,
    legalProvider: "mock-clio",
    maxUploadBytes: MAX_UPLOAD_BYTES,
  };
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    try {
      const path = url.pathname;
      // Railway probes use healthcheck.railway.app; this public route returns no user data.
      if (request.method === "GET" && path === "/api/health") {
        return json({ ok: true });
      }
      if (!allowedHosts.has(url.host)) {
        throw new AppError(403, "Use the configured app URL.");
      }
      // Reject cross-origin browser requests, including simple form posts.
      const origin = request.headers.get("origin");
      if (
        origin && !allowedOrigins.includes(origin)
      ) throw new AppError(403, "Origin is not allowed.");
      // Static assets and the health probe remain public; every other API route requires Clerk.
      const identity = path.startsWith("/api/")
        ? await options.authenticate(request)
        : null;
      if (identity && request.method === "GET" && path === "/api/config") {
        return json(config);
      }
      const workflow = identity
        ? await options.getWorkspace(identity.userId)
        : null;
      if (path.startsWith("/api/") && !workflow) {
        throw new AppError(401, "Sign in to access your workspace.");
      }
      if (!workflow) return await serveStatic(request, url, options.distDir);
      if (path === "/api/usage" && request.method === "GET") {
        return json(await workflow.repo.getUsage());
      }
      if (path === "/api/meetings" && request.method === "GET") {
        return json((await workflow.repo.listMeetings()).map(publicMeeting));
      }
      if (path === "/api/matters" && request.method === "GET") {
        return json(await workflow.repo.listMatters());
      }
      if (path === "/api/matters" && request.method === "POST") {
        const body = parseInput(CreateMatterSchema, await bodyJson(request));
        return json(
          await workflow.repo.createMatter({
            id: crypto.randomUUID(),
            ...body,
          }),
          201,
        );
      }
      if (path === "/api/meetings" && request.method === "POST") {
        if (
          request.headers.get("content-type")?.startsWith("application/json")
        ) {
          const body = parseInput(DemoMeetingSchema, await bodyJson(request));
          return json(
            publicMeeting(
              await workflow.create({
                title: body.title,
                source: "demo",
                consent: body.consent,
              }),
            ),
            202,
          );
        }
        // Fail fast for exhausted users before reading or storing a potentially large recording.
        await workflow.repo.assertCreditAvailable();
        let form: FormData;
        try {
          const bytes = await boundedBody(request, MAX_BODY_BYTES);
          form = await new Request(request.url, {
            method: "POST",
            headers: {
              "content-type": request.headers.get("content-type") ?? "",
            },
            body: bytes as BodyInit,
          }).formData();
        } catch (error) {
          if (error instanceof AppError) throw error;
          throw new AppError(400, "Upload a valid audio file.");
        }
        const file = validateAudioFile(form.get("audio"));
        const input = parseInput(UploadMeetingSchema, {
          title: form.get("title"),
          source: form.get("source"),
          consent: form.get("consent"),
          duration: form.get("duration") ?? "0",
        });
        const audioPath = await audio.put(
          new Uint8Array(await file.arrayBuffer()),
          file.type || "application/octet-stream",
        );
        try {
          return json(
            publicMeeting(
              await workflow.create({
                ...input,
                audioPath,
                audioMime: file.type || "application/octet-stream",
              }),
            ),
            202,
          );
        } catch (error) {
          await audio.remove(audioPath);
          throw error;
        }
      }
      const match = path.match(
        /^\/api\/meetings\/([^/]+)(?:\/(retry|save|audio))?$/,
      );
      if (match) {
        const [, rawId, action] = match;
        const id = parseInput(MeetingIdSchema, rawId);
        if (!action && request.method === "GET") {
          return json(publicMeeting(await workflow.repo.getMeeting(id)));
        }
        if (!action && request.method === "DELETE") {
          parseInput(DeleteMeetingSchema, await bodyJson(request));
          await workflow.delete(id, audio);
          return json({ deleted: true });
        }
        if (!action && request.method === "PATCH") {
          return json(
            publicMeeting(await workflow.patch(id, await bodyJson(request))),
          );
        }
        if (action === "retry" && request.method === "POST") {
          return json(publicMeeting(await workflow.retry(id)), 202);
        }
        if (action === "save" && request.method === "POST") {
          return json(
            publicMeeting(
              await workflow.saveToMatter(
                id,
                parseInput(SaveMeetingSchema, await bodyJson(request)).reviewed,
              ),
            ),
          );
        }
        if (action === "audio" && request.method === "GET") {
          const meeting = await workflow.repo.getMeeting(id);
          if (!meeting.audioPath) {
            throw new AppError(
              404,
              "This demo meeting has no audio recording.",
            );
          }
          return new Response(await audio.read(meeting.audioPath) as BodyInit, {
            headers: {
              "content-type": meeting.audioMime ?? "application/octet-stream",
              "cache-control": "no-store",
            },
          });
        }
      }
      if (path.startsWith("/api/")) {
        throw new AppError(404, "Endpoint not found.");
      }
      throw new AppError(404, "Not found.");
    } catch (error) {
      const status = error instanceof AppError ? error.status : 500;
      return json({
        ...(error instanceof AppError && error.code
          ? { code: error.code }
          : {}),
        error: status === 500
          ? "Something went wrong. Please try again."
          : (error as Error).message,
      }, status);
    }
  };
}

async function serveStatic(
  request: Request,
  url: URL,
  distDir?: string,
): Promise<Response> {
  const path = url.pathname;
  if (distDir && request.method === "GET") {
    const relative = decodeURIComponent(path).replace(/^\/+/, "");
    if (relative.split("/").some((s) => s === ".." || s.includes("\\"))) {
      throw new AppError(400, "Invalid path.");
    }
    const asset = relative.includes(".") ? relative : "index.html";
    try {
      const bytes = await Deno.readFile(`${distDir}/${asset}`);
      const ext = asset.split(".").pop();
      const mime: Record<string, string> = {
        html: "text/html",
        js: "text/javascript",
        css: "text/css",
        svg: "image/svg+xml",
        png: "image/png",
        ico: "image/x-icon",
      };
      return new Response(bytes, {
        headers: {
          "content-type": mime[ext ?? ""] ?? "application/octet-stream",
          "x-content-type-options": "nosniff",
        },
      });
    } catch {
      throw new AppError(
        404,
        "App assets missing. Run npm run build first.",
      );
    }
  }

  throw new AppError(404, "Not found.");
}
