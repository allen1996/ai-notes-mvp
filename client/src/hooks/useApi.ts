import { useContext } from "react";
import { ApiContext } from "@client/lib/api-context.ts";
import type { Api } from "@client/lib/api.ts";

export function useApi(): Api {
  const api = useContext(ApiContext);
  if (!api) throw new Error("API access requires a signed-in workspace.");
  return api;
}
