import type { AppConfig, Matter, Meeting } from "@lib/types/meeting.ts";
import type { AiUsage } from "@lib/types/usage.ts";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

/** Tokens come from Clerk for each request; never store them in app state or URLs. */
export function createApi(
  getToken: () => Promise<string | null>,
  http: typeof fetch = fetch,
) {
  async function authorizedFetch(path: string, options: RequestInit = {}) {
    const token = await getToken();
    if (!token) {
      throw new ApiError(
        401,
        "Your session has expired. Please sign in again.",
      );
    }
    const headers = new Headers(options.headers);
    headers.set("authorization", `Bearer ${token}`);
    if (options.body && !(options.body instanceof FormData)) {
      headers.set("content-type", "application/json");
    }
    const response = await http(`/api${path}`, {
      ...options,
      headers,
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
    });
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new ApiError(
        response.status,
        data?.error ?? `Request failed (${response.status}).`,
        data?.code,
      );
    }
    return response;
  }
  async function request<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const response = await authorizedFetch(path, options);
    const data = await response.json().catch(() => null);
    if (!data) {
      throw new Error(
        "Unable to connect. Please try again.",
      );
    }
    return data as T;
  }
  return {
    config: () => request<AppConfig>("/config"),
    usage: () => request<AiUsage>("/usage"),
    deleteMeeting: (id: string) =>
      request<{ deleted: true }>(`/meetings/${encodeURIComponent(id)}`, {
        method: "DELETE",
        body: JSON.stringify({ confirmed: true }),
      }),
    meeting: (id: string) =>
      request<Meeting>(`/meetings/${encodeURIComponent(id)}`),
    meetings: () => request<Meeting[]>("/meetings"),
    matters: () => request<Matter[]>("/matters"),
    createDemo: (title: string, consent: boolean) =>
      request<Meeting>("/meetings", {
        method: "POST",
        body: JSON.stringify({ title, consent, source: "demo" }),
      }),
    upload: (form: FormData) =>
      request<Meeting>("/meetings", { method: "POST", body: form }),
    patch: (id: string, patch: Partial<Meeting>) =>
      request<Meeting>(`/meetings/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    retry: (id: string) =>
      request<Meeting>(`/meetings/${id}/retry`, { method: "POST" }),
    save: (id: string) =>
      request<Meeting>(`/meetings/${id}/save`, {
        method: "POST",
        body: JSON.stringify({ reviewed: true }),
      }),
    createMatter: (input: Pick<Matter, "name" | "client" | "reference">) =>
      request<Matter>("/matters", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    audio: async (id: string, signal: AbortSignal) =>
      (await authorizedFetch(`/meetings/${id}/audio`, { signal })).blob(),
  };
}
export type Api = ReturnType<typeof createApi>;
