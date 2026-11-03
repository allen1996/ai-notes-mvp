import { createContext } from "react";
import type { Api } from "@client/lib/api.ts";

export const ApiContext = createContext<Api | null>(null);
