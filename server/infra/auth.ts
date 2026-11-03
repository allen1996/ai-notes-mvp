import { createClerkClient } from "@clerk/backend";
import { AppError } from "@server/utils/errors.ts";

export interface Identity {
  userId: string;
  sessionId: string;
}
export type Authenticate = (request: Request) => Promise<Identity>;
export const LOCAL_ORIGINS = [
  "http://127.0.0.1:5173",
  "http://localhost:5173",
  "http://127.0.0.1:8787",
  "http://localhost:8787",
];

export function createClerkAuthenticator(config: {
  secretKey?: string;
  publishableKey?: string;
  allowedOrigins: string[];
  jwtKey?: string;
}): Authenticate {
  if (!config.secretKey || !config.publishableKey) {
    return async () => {
      throw new AppError(
        503,
        "Clerk is not configured. Set VITE_CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY on the server, then restart.",
      );
    };
  }
  const client = createClerkClient({
    secretKey: config.secretKey,
    publishableKey: config.publishableKey,
    telemetry: { disabled: true },
  });
  return async (request) => {
    // Explicit bearer tokens keep API auth consistent in dev, production, and audio fetches.
    if (!/^Bearer \S+$/i.test(request.headers.get("authorization") ?? "")) {
      throw new AppError(401, "Sign in to access your workspace.");
    }
    try {
      const state = await client.authenticateRequest(request, {
        authorizedParties: config.allowedOrigins,
        acceptsToken: "session_token",
        jwtKey: config.jwtKey,
      });
      if (!state.isAuthenticated) {
        throw new AppError(
          401,
          "Your session has expired. Please sign in again.",
        );
      }
      const identity = state.toAuth();
      if (!identity.userId || !identity.sessionId) {
        throw new AppError(401, "Sign in to access your workspace.");
      }
      return { userId: identity.userId, sessionId: identity.sessionId };
    } catch (error) {
      if (error instanceof AppError) throw error;
      // Never forward SDK errors: they can include request/token details.
      throw new AppError(
        401,
        "We could not verify your session. Please sign in again.",
      );
    }
  };
}
