# Meet MVP

A focused meeting-to-file-note workflow inspired by
[VXT Meet](https://www.vxt.ai/products/meet). React + TypeScript frontend, Deno
backend, Prisma ORM over SQLite, Zod input validation, and AssemblyAI for real
transcription and AI notes. Ready for Railway with a persistent volume and
optional private R2 audio storage.

## Free notes and deletion

Each signed-in Clerk user receives **3 lifetime AI credits**. A recording or
manual retry consumes one credit, even when processing fails; deleting a meeting
does not restore it. Examples always use the mock provider and consume no
credit. The allowance is enforced in a database transaction before work is
queued, so concurrent requests cannot exceed three credits. Existing non-example
meetings are counted once at startup (capped at three); their original data is
preserved. The ledger survives restarts and deletion on the same Railway volume.

The sidebar shows the remaining allowance. Exhausted accounts can still review
existing notes and create examples. Recording/upload controls are disabled, and
HTTP requests receive `402` with code `AI_QUOTA_EXHAUSTED`. The Upgrade screen
is an informational mock: its upgrade button is disabled and there is no payment
or plan-changing endpoint. No extra credentials or billing integration are
needed.

The trash button opens a small confirmation dialog. Confirming deletion removes
the meeting, its notes, local mock export, and recording from the configured
local or R2 storage. The API requires an authenticated owner and
`DELETE /api/meetings/:id` with JSON `{ "confirmed": true }`. Active AI work is
cancelled. A durable deletion marker prevents late results from restoring data;
if storage cleanup fails, the meeting stays **Deletion pending**, can be retried
from its trash button, and cleanup is attempted again at startup. Missing audio
is treated as already deleted. This removes app-owned audio; it does not manage
copies already submitted to AssemblyAI or exports saved outside this app.

`GET /api/usage` returns `{ limit, used, remaining }` for the authenticated
user. The compact account menu provides account management and sign out without
the large Clerk UserButton popover. The login screen uses VXT’s public X symbol
from [its homepage](https://www.vxt.ai/), with a wind-up/spin loop and
reduced-motion support.

## Deploy on Railway

Follow the [Railway deployment guide](docs/railway.md) for the exact setup:
connect this app directory, attach a volume at **`/data`**, generate an HTTPS
domain, and set the matching Clerk keys in Railway Variables. The included
`Dockerfile` and `railway.json` build React and run one Deno service, with
health checks, restart handling, and persistent SQLite. `APP_ORIGIN` configures
the hosted origin; `PORT` and the volume mount are supplied by Railway.

Start with `AI_PROVIDER=mock` and `AUDIO_STORAGE=local` for a credential-light
demo, or enable AssemblyAI and private Cloudflare R2 using the guide. Local
`.env` and recordings are excluded from Docker and CLI upload contexts. They are
not copied into a hosted deployment.

## Run locally

Requirements: **Deno 2.9+**, **Node.js 20.9+**, and npm. Node.js 22.12+ is
recommended; the commands below are also tested with Deno 2.9.5 and Node.js
20.10. Prisma CLI runs under Deno, rather than the installed Node version.

```sh
npm ci --ignore-scripts
npm run db:generate
cp -n .env.example .env  # preserve an existing .env
npm run dev
```

Open **http://127.0.0.1:5173**. Vite proxies `/api` to the Deno server on
port 8787. Both bind to loopback. Configure your Clerk development keys below
and sign in. The AI provider defaults to a mock and needs no AssemblyAI key.

To run the production build locally with one Deno server:

```sh
npm run build
npm start
```

Open **http://127.0.0.1:8787**. Stop with Ctrl+C. The frontend publishable key
is embedded at build time, so rebuild after changing it. Without Clerk keys, the
frontend shows setup instructions and the API denies access.

## Prisma ORM and Zod

Prisma **7.10.1** and Zod **4.6.7** are pinned. After installing dependencies,
run `npm run db:generate` before starting the server, running checks, or running
tests. It generates the Deno/ESM client in `server/generated/prisma/` from
`server/tables/schema.prisma`. Generated code is ignored by Git and excluded
from the source archive; CI and Docker generate their own copy. Installation
skips dependency lifecycle scripts, and client generation is an explicit step.
Older Node versions may print Prisma package engine warnings during
installation; the CLI itself is executed with Deno.

The server uses Prisma's official libSQL adapter against the same **local SQLite
file**, with no Turso account, remote database, or new credentials. Deno's tasks
include `--allow-ffi` for the adapter's bundled native driver and `--allow-sys`
for Linux platform detection. Meeting, matter, export, metadata, and allowance
queries use the generated Prisma API. Owner filters are bound from Clerk's
verified identity, and changes/exports use database transactions. Repository
operations and shutdown are now asynchronous.

The existing JSON record payloads and case-insensitive matter references are
preserved. `tables/migrate.ts` performs schema initialization, the existing
anonymous-record compatibility migration, and the AI allowance backfill through
Prisma inside a transaction. It does not reset or rewrite owner-scoped records.
`schema.ts` retains the SQLite bootstrap DDL, including its `COLLATE NOCASE`
constraint; update it alongside `schema.prisma` when changing the physical
schema. General Prisma Migrate history/baselining is not introduced in this
compatibility change.

Zod schemas in `server/models/inputs.ts` validate meeting creation/edits, matter
creation, reviewed saves, multipart metadata, file limits/formats, and meeting
IDs. `models/notes.ts` validates generated notes and edited action items.
Unknown input fields are stripped, so request payloads cannot change ownership,
processing status, storage paths, or provider configuration. Malformed writes
return client errors before persistence; business rules such as matter ownership
and saved-record immutability remain in the workflow.

References:
[Prisma SQLite adapters](https://www.prisma.io/docs/orm/v7/core-concepts/supported-databases/sqlite),
[Deno client generation](https://www.prisma.io/docs/orm/v7/prisma-schema/overview/generators),
and [Zod parsing](https://zod.dev/basics).

## VS Code and import aliases

Open the `meet-mvp` folder itself in VS Code so its `.vscode/settings.json`
applies. Deno is enabled for `server/`, `lib/`, and the Deno-based tests in
`client/tests/`. React source and `client/vite.config.ts` use VS Code's
TypeScript language service. This follows
[Deno's mixed-workspace setup](https://docs.deno.com/runtime/reference/vscode/#partially-enabling-deno-in-a-vs-code-workspace).
If diagnostics from the old configuration remain, run **Developer: Reload
Window** from the command palette.

| Alias      | Directory     | Used by                                 |
| ---------- | ------------- | --------------------------------------- |
| `@client/` | `client/src/` | React, TypeScript, Vite, client tests   |
| `@server/` | `server/`     | Deno server and server tests            |
| `@lib/`    | `lib/`        | Shared contracts, helpers, and fixtures |

```ts
import { useApi } from "@client/hooks/useApi.ts";
import type { Meeting } from "@lib/types/meeting.ts";
```

Client aliases are configured in `client/tsconfig.json` and
`client/vite.config.ts`; root `tsconfig.json` extends the client settings. Deno
aliases and workspace members are configured in the root `deno.json`. Local
TypeScript imports keep explicit `.ts`/`.tsx` extensions so shared code also
resolves in Deno. VS Code auto-imports prefer non-relative paths. No extra alias
plugin is needed.

## Clerk login and logout

Use the **development instance of your existing Clerk application**. From its
API keys page, add the matching keys to the project root `.env`:

```dotenv
VITE_CLERK_PUBLISHABLE_KEY=pk_test_your_key
CLERK_SECRET_KEY=sk_test_your_key
```

- The publishable key is public; Vite reads it from the root `.env` and embeds
  it in React.
- The secret key is read only by Deno. Never give it a `VITE_` prefix, put it in
  source code, or commit `.env`.
- In Clerk, enable **Google** under SSO connections (sometimes labelled Social
  connections). This is already enabled in the development application used for
  verification. Other sign-in methods follow your Clerk dashboard configuration.
- Run `npm run dev`, open **http://127.0.0.1:5173**, and choose **Continue with
  Google**. The private workspace mounts only after Clerk confirms the session.
- The embedded `<SignIn withSignUp transferable />` gives Google and email users
  one entry form: existing users sign in, while new users continue into sign-up
  automatically. Sign-ups must be allowed in the Clerk instance. Verification
  and required profile fields still follow the dashboard settings. See
  [Clerk's sign-in-or-up option](https://clerk.com/docs/react/reference/components/authentication/sign-in#properties).
- Use **Sign out** in the sidebar account menu. Signing out returns to the login
  screen and unmounts meeting state and audio URLs.
- Restart after changing `.env`. For the built app, run `npm run build` again
  before `npm start`.

Every API data request obtains a Clerk session token and sends it as a bearer
header. The Deno backend verifies it with Clerk's SDK, accepts session tokens
only, and checks authorized frontend origins. Missing, expired, forged, pending,
or wrong-origin sessions are rejected. Audio is fetched with the same
authentication and exposed to the player through a temporary local blob URL;
tokens never appear in audio URLs.

Supported local origins are `http://127.0.0.1:5173`, `http://localhost:5173`,
`http://127.0.0.1:8787`, and `http://localhost:8787`. Use a consistent hostname
throughout a login. No Clerk webhooks, custom JWT template, or separate Google
OAuth credentials are needed for this local development flow. The implementation
follows the
[React quickstart](https://clerk.com/docs/react/getting-started/quickstart) and
[backend authentication reference](https://clerk.com/docs/reference/backend/authenticate-request).

For production, provide the final HTTPS domain and matching Clerk production
keys. Configure that origin in Clerk and the backend, use your own Google OAuth
credentials in Clerk as required by the production Google connection, and deploy
the Deno server behind HTTPS. Railway uses `APP_ORIGIN` (or its generated public
domain) for session authorization and binds to `0.0.0.0:$PORT`. Local
development continues to bind to loopback.

Each Clerk user has a **personal workspace**. Meetings, matters, exports, seed
state, and audio authorization are scoped using the verified user ID. Shared
firm/team workspaces are not included yet. Existing anonymous records are
migrated transactionally into a reserved legacy namespace and preserved in the
same database; they are not assigned to the first person who signs in. Legacy
records need an explicit ownership migration if you want them in a particular
account.

## First walkthrough

1. Sign in with Clerk, then choose **New meeting → Try an example**, confirm the
   fictional-data notice, and create the meeting.
2. Watch it move through transcription and note generation. Examples always use
   a fictional fixture, even with AssemblyAI enabled.
3. Edit the summary, key points, or action items. Search the speaker-labelled
   transcript, or write and save **My notes**.
4. Choose a matter (create one under **Matters** if needed), confirm your
   review, and **Save to matter**.
5. The mock Clio adapter stores a file note, transcript, personal notes, action
   items, and one time entry locally. Repeated saves return the same record.
   Saved file notes are read-only.
6. Use the download button for a Markdown copy of the full record.

You can also record your microphone with pause/resume, or upload MP3, M4A, MP4,
WAV, WebM, OGG, or FLAC audio up to **50 MB**. Browser recording requires a
secure context, including localhost. It captures the microphone, not system
audio or remote participants. For video meetings, upload a recording that
contains all speakers.

**Mock mode is explicit:** real uploads are stored for playback but are not
transcribed. They get an explanatory placeholder, never a fabricated transcript.
The three seeded meetings contain fictional sample information.
`SEED_DEMO=false` starts a new database without those samples; it does not
remove existing data.

## Enable AssemblyAI

Provide an **AssemblyAI API key with billing and LLM Gateway access**. Keep it
in the backend's `.env`:

```dotenv
AI_PROVIDER=assemblyai
ASSEMBLYAI_API_KEY=your_private_key
ASSEMBLYAI_LLM_MODEL=claude-sonnet-4-5-20250929
```

Restart the app and create a **new** recorded/uploaded meeting. Existing mock
records remain labelled as mock records. The Integrations screen shows the
active provider. No secret is shipped to React.

The server uploads audio to AssemblyAI, submits a diarized transcription job,
polls for completion, then sends the transcript to AssemblyAI's **LLM Gateway**
for structured summary, key points, and agreed actions. The model is
configurable. This uses the current Gateway API, not deprecated
LeMUR/summarization parameters. Responses are validated before becoming editable
notes. The integration follows the
[official transcription model documentation](https://www.assemblyai.com/docs/pre-recorded-audio/select-the-speech-model)
and
[LLM Gateway audio guide](https://www.assemblyai.com/docs/llm-gateway/apply-llms-to-audio-files).

The implementation uses AssemblyAI's US endpoints. Enabling it sends audio and
transcript content to AssemblyAI and the selected Gateway model provider. The
live paid API has **not** been called or verified with a real key in this build;
its HTTP contract is tested with injected responses.

## What you need to provide next

| Capability               | MVP behavior                                             | Needed for the live version                                                                                                             |
| ------------------------ | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Login/logout             | Clerk Google sign-in and protected personal workspaces   | Matching Clerk publishable/secret keys; Google enabled in your Clerk app                                                                |
| AI transcription + notes | Mock by default; real AssemblyAI adapter implemented     | AssemblyAI API key and funded account with Gateway/model access                                                                         |
| Legal software           | Local mock Clio, no external requests                    | Choose a practice platform; for Clio, provide a developer app, OAuth client ID/secret, redirect URL, scopes, and a sandbox/test account |
| Meeting capture          | Browser microphone and audio upload                      | Meeting-bot provider and credentials if automatic Zoom/Meet/Teams attendance is desired                                                 |
| Calendar                 | Not included                                             | Google/Microsoft OAuth app and approved scopes if calendar sync is desired                                                              |
| Hosted app               | Railway Docker configuration, SQLite volume, optional R2 | Railway volume/domain and service variables; Clerk keys, plus R2 credentials when enabled                                               |

## Quality checks

```sh
npm test          # Core workflow, HTTP handlers, provider contracts, persistence
npm run check    # Deno and React TypeScript checks
npm run build    # React production build
# After building the image as described in docs/railway.md:
npm run test:container  # Container startup, auth/origins, persistent SQLite
```

The test suite uses isolated temporary SQLite databases through Prisma and
mocked AssemblyAI HTTP responses, plus locally signed JWTs verified by the real
Clerk SDK. Tests need no credentials, microphone access, or network access. CI
runs all three commands plus the Docker build and container smoke test for
pushes and pull requests. See [verification notes](docs/verification.md) for the
browser checks and their limits.

## Code map

```text
client/
  src/
    components/
      auth/            AccountControls, AuthenticatedApi provider
      matters/         NewMatter form
      meetings/        NewMeeting capture, MeetingDetail review
      ui/              Modal, Spinner, Status, Empty
    hooks/             useApi, useRecorder
    lib/               Authenticated API client and context
    public/            Static browser assets
    routes/            AuthScreen, Workspace, Integrations
    schemas/           Browser form validation
    styles/            App and authentication styles
    types/             Client-only navigation types
    App.tsx            Root composition
    index.html         Vite HTML entry
    index.tsx          React entry
  tests/               API-client contract tests (Deno)
  deno.json            Client task shortcuts
  tsconfig.json        Browser TypeScript configuration and aliases
  vite.config.ts       Vite root, aliases, proxy, and build output
  vite-env.d.ts        Public build-variable types
server/
  infra/               Clerk, AssemblyAI, mock AI, audio storage, config
  models/              Provider interfaces, Zod input and note schemas
  operations/          Meeting workflow, user workspaces, demo seeding
  routes/              HTTP API and deployment/authentication contracts
  tables/              Prisma schema/config, repository, SQLite compatibility bootstrap
  utils/               Application errors and server test fixtures
  deno.json            Server task shortcuts
  main.ts              Startup, recovery, and HTTP server composition
lib/
  fixtures/            Fictional consultation data
  testing/             Runtime-independent test assertions
  types/               Shared meeting, matter, notes, and API contracts
  utils/               Shared duration, status, and billing helpers
```

Use **PascalCase** for React component files, **useCamelCase** for hook files,
and **kebab-case** for other multiword TypeScript files and directories. Tests
use **`*.test.ts`**: server tests sit beside the module they cover; client API
tests live in `client/tests/` so browser source keeps native TypeScript
checking. Shared `lib/` code does not import from either the client or server;
server operations depend on models and tables rather than concrete AI adapters.

The root `package.json` and `deno.json` remain the main command entry points.
Use `npm run dev:client` or `npm run dev:server` to start either side
separately. The member `deno.json` files also support `deno task dev`, `check`,
and `test` from their directories; the client adds `build`, and the server adds
`start`. Server shortcuts execute from the project root so existing `.env` and
`.data/` paths stay consistent. The frontend build is generated in
**`client/dist/`** and served by Deno. Build output and caches are ignored
rather than stored in source directories.

## Persistence and boundaries

Records live in `.data/meet.sqlite`, and audio in `.data/audio/`. This is
unencrypted local development storage; `.env` and `.data/` are ignored by Git
and excluded from the source archive. Clerk authenticates users, and SQLite
queries enforce per-user ownership. Local development binds to `127.0.0.1`.
Railway uses `DATA_DIR=/data` on a persistent volume and can store new audio in
private R2. Hosted requests use the configured HTTPS origin; foreign browser
origins/hosts are rejected. Configure operational backups and retention to suit
your data before wider production use. The initial deployment starts a new
database; your local records are not uploaded.

Processing jobs run in the Deno process. Transcript IDs and completed
transcripts are persisted; queued work resumes at startup. A retry after note
generation fails reuses the transcript rather than paying for transcription
again. If the process stops between a vendor accepting a submission and
persisting its ID, a retry can submit again; a durable external job queue and
vendor reconciliation are future production work.

The local mock export uses a SQLite transaction and a unique record per meeting.
It rounds duration up to six-minute units, with a six-minute minimum. Real
practice integrations should preserve this idempotency when replacing the mock
boundary. Large recordings and team workloads will need streaming object storage
and a durable worker queue.

The built frontend and Deno backend run together locally or in the Railway
container. Deployment configuration is included; no live Railway deployment is
created by changing these source files.
