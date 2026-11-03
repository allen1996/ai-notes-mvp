import { useAuth } from "@clerk/react";
import { type ReactNode, useMemo } from "react";
import { createApi } from "@client/lib/api.ts";

import { ApiContext } from "@client/lib/api-context.ts";

export function AuthenticatedApi({ children }: { children: ReactNode }) {
  const { getToken } = useAuth();
  const api = useMemo(() => createApi(getToken), [getToken]);
  return <ApiContext.Provider value={api}>{children}</ApiContext.Provider>;
}
