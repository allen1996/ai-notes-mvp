# syntax=docker/dockerfile:1
FROM denoland/deno:2.9.5 AS deno
FROM node:22-bookworm-slim AS build
COPY --from=deno /usr/bin/deno /usr/local/bin/deno
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY client ./client
COPY lib ./lib
COPY server ./server
RUN npm run db:generate
# Only the PUBLIC Clerk key is needed at build time. Never add secret keys here.
ARG VITE_CLERK_PUBLISHABLE_KEY
RUN test -n "$VITE_CLERK_PUBLISHABLE_KEY" && npm run build
RUN npm prune --omit=dev --ignore-scripts

FROM denoland/deno:2.9.5 AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=8787 DATA_DIR=/data
COPY --from=build /app/node_modules ./node_modules
COPY package.json deno.json ./
COPY --from=build /app/server ./server
COPY lib ./lib
# Deno workspace resolution needs the client manifest; browser source stays in the build stage.
COPY client/deno.json ./client/deno.json
COPY --from=build /app/client/dist ./client/dist
RUN deno cache server/main.ts
# Railway volumes are root-owned. Deno still runs with explicit runtime permissions.
USER root
EXPOSE 8787
ENTRYPOINT ["deno"]
CMD ["task", "serve"]
