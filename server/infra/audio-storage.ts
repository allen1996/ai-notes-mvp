import { AwsClient } from "aws4fetch";
import { AppError } from "@server/utils/errors.ts";

export interface AudioStorage {
  put(bytes: Uint8Array, mime: string): Promise<string>;
  read(reference: string): Promise<Uint8Array>;
  remove(reference: string): Promise<void>;
}

export class LocalAudioStorage implements AudioStorage {
  constructor(private directory: string) {}
  async put(bytes: Uint8Array, _mime: string) {
    const path = `${this.directory}/${crypto.randomUUID()}`;
    await Deno.writeFile(path, bytes);
    return path;
  }
  async read(path: string) {
    try {
      return await Deno.readFile(path);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        throw new AppError(404, "The audio recording could not be found.");
      }
      throw error;
    }
  }
  async remove(path: string) {
    try {
      await Deno.remove(path);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
  }
}

/** Private S3-compatible R2 objects; references never leave the authenticated API. */
export class R2AudioStorage implements AudioStorage {
  private client: AwsClient;
  private endpoint: string;
  constructor(
    config: {
      accountId: string;
      bucket: string;
      accessKeyId: string;
      secretAccessKey: string;
    },
    private http: typeof fetch = fetch,
  ) {
    this.endpoint =
      `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucket}`;
    this.client = new AwsClient({
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      service: "s3",
      region: "auto",
    });
  }

  private async request(reference: string, init: RequestInit) {
    // Only app-generated object keys are accepted, never URLs from a request body.
    if (!/^r2:audio\/[0-9a-f-]{36}$/.test(reference)) {
      throw new AppError(500, "Invalid audio storage reference.");
    }
    const key = reference.slice(3);
    try {
      const request = await this.client.sign(`${this.endpoint}/${key}`, {
        ...init,
        signal: AbortSignal.timeout(120_000),
      });
      const response = await this.http(request);
      if (init.method === "DELETE" && response.status === 404) return response;
      if (!response.ok) {
        await response.body?.cancel();
        throw new AppError(
          response.status === 404 ? 404 : 502,
          response.status === 404
            ? "The audio recording could not be found."
            : "Audio storage is unavailable. Please try again.",
        );
      }
      return response;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        502,
        "Audio storage is unavailable. Please try again.",
      );
    }
  }
  async put(bytes: Uint8Array, mime: string) {
    const reference = `r2:audio/${crypto.randomUUID()}`;
    const response = await this.request(reference, {
      method: "PUT",
      headers: { "content-type": mime },
      body: bytes as BodyInit,
    });
    await response.body?.cancel();
    return reference;
  }
  async read(reference: string) {
    return new Uint8Array(
      await (await this.request(reference, { method: "GET" })).arrayBuffer(),
    );
  }
  async remove(reference: string) {
    const response = await this.request(reference, { method: "DELETE" });
    await response.body?.cancel();
  }
}

/** Preserve existing volume recordings when switching new uploads to R2. */
export function audioStorage(
  local: LocalAudioStorage,
  r2?: R2AudioStorage,
): AudioStorage {
  const storageFor = (reference: string): AudioStorage => {
    if (!reference.startsWith("r2:")) return local;
    if (!r2) {
      throw new AppError(503, "Configure R2 to access this audio recording.");
    }
    return r2;
  };
  return {
    put: (bytes, mime) => (r2 ?? local).put(bytes, mime),
    read: (reference) => storageFor(reference).read(reference),
    remove: (reference) => storageFor(reference).remove(reference),
  };
}
