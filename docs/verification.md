# Verification

## Deletion and free allowance

- Nine simultaneous recording requests reserve exactly three credits; other
  requests receive `AI_QUOTA_EXHAUSTED`. Another user has an independent quota.
- Failed jobs/manual retries count; examples never invoke the paid provider.
  Deletion and SQLite reopen do not refund credits.
- Existing pre-quota data backfills usage once, excludes examples, and caps
  at 3.
- HTTP quota rejection occurs before audio storage. Authenticated examples still
  work after exhaustion; the frontend preserves the server's upgrade error code.
- Deletion checks ownership and explicit confirmation, removes real local audio,
  notes and mock exports, and leaves another user's allowance untouched.
- Signed R2 DELETE failure leaves a durable deletion marker. Startup recovery
  and DELETE 404 are safe; late provider results cannot recreate deleted
  meetings.
- AssemblyAI cancellation reaches active fetches and prevents later requests.
- Frontend deletion sends a fresh bearer token and the explicit confirmation
  body.

The new UI was verified in a separate localhost preview using temporary SQLite
and mock AI. Live Clerk sign-in loaded the isolated workspace. The compact
account menu, deletion confirmation/cancel, 0/3 sidebar allowance, disabled
record/upload controls, and disabled mock upgrade were checked. An example
created at zero credits completed successfully without changing the allowance.
Mobile navigation, account menu, upgrade layout and login were inspected at
390px width with no horizontal overflow. The logo reports the expected spin
animation; CSS disables it for reduced motion. No user meetings were removed and
no paid AI was invoked.

Browser file upload was blocked by the extension's file URL permission; storage,
quota rejection and audio deletion were verified through the automated HTTP
suite. The exhausted UI used recordings seeded into the temporary preview only.
Screenshots: `account-menu.jpg`, `delete-meeting.jpg`, `upgrade.jpg`,
`mobile-account.jpg`, `mobile-upgrade.jpg`, `login.jpg`, and `login-mobile.jpg`.

## Automated

44 Deno tests cover:

- Capture, transcription, notes, edits, and matter export through the workflow
  and HTTP handler.
- Consent/title validation, malformed JSON, upload size/type checks, allowed
  browser origins, and missing records.
- Audio persistence/playback bytes and hiding server filesystem paths from HTTP
  responses.
- Review/matter requirements and eight concurrent save requests producing a
  single export/time entry.
- Immutable saved notes and case-insensitive duplicate matter references.
- Failed note generation retrying without transcribing again.
- Deduplicated workers and resuming persisted transcription IDs.
- Explicit mock placeholders for real uploads.
- Long transcript and export persistence across SQLite reopen.
- Six-minute rounding boundaries.
- AssemblyAI raw authorization, binary upload, model/speaker config, polling,
  and LLM Gateway request/response mapping.
- Existing-job reuse, no-speech audio, invalid AI JSON/schema, and safe vendor
  error messages.

Additional authentication coverage verifies:

- Real RSA-signed session JWTs with Clerk's actual SDK, using a generated public
  key without network access.
- Rejection of missing, malformed, forged, expired, pending, and wrong-origin
  tokens.
- Fail-closed behavior with missing Clerk configuration.
- Authentication on every API data route, including audio, while health and
  static login assets remain public.
- Cross-user read, edit, retry, save, audio, matter, export, and metadata
  isolation; body/query ownership spoofing is ignored.
- Each user receiving separate fictional seed data and independent matter
  references.
- Transactional preservation of anonymous records without assigning them to
  signed-in users.
- Fresh tokens on JSON, multipart, and audio fetches; no network call when the
  client has no session.

`npm run check` checks both frontend and backend types; `npm run build` produces
the Vite production bundle. CI repeats these commands, builds the Railway Docker
image with a dummy public key, and runs the disposable container smoke test.

## Railway preparation

After the client/server/lib refactor, the same tests run from their new
locations: client API contracts in `client/tests/`, server tests alongside their
respective modules, and shared assertions in `lib/testing/`. The root commands
and Docker configuration use the new paths. The generated browser bundle is
`client/dist/`.

- Configuration tests cover Railway port binding, HTTPS origin selection,
  persistent volume requirements, and missing service credentials.
- A hosted HTTP workflow verifies upload, completed mock notes, private
  playback, and owner isolation after reopening SQLite from the same data
  directory.
- R2 contract tests use real AWS SigV4 signing with mocked HTTP: binary
  PUT/GET/DELETE, safe errors, and continued access to existing local audio.
- The container smoke test checks React assets, Railway's health-check hostname,
  missing-session and foreign-origin/host rejection, and a SQLite record
  surviving container restart on a disposable volume.
- A signed Clerk JWT test verifies the hosted HTTPS authorized party when Deno
  receives HTTP behind Railway's TLS proxy, and rejects localhost sessions.

The Docker image was built locally with a dummy public key and the container
smoke test passed. No user credentials were used for that test. Type checks, all
44 Deno tests, and the React production build also passed.

## Prisma and Zod

- All repository data access now runs through Prisma's generated Deno client and
  the official libSQL adapter, using isolated SQLite files for tests.
- Existing workflow tests continue to cover concurrent idempotent exports,
  recovery, ownership, and persistence after reopening the database.
- An additional test opens a pre-Prisma owner-scoped database, verifies existing
  meeting bytes and seed metadata are unchanged, rejects cross-user reads, and
  preserves case-insensitive matter-reference uniqueness.
- New HTTP tests reject invalid JSON write shapes, non-boolean consent/review,
  malformed edited notes, invalid multipart duration/source/consent, and
  oversized personal notes. They assert invalid requests create neither database
  rows nor audio files, and protected meeting fields are ignored.
- CI explicitly generates Prisma before checks/tests; Docker generates it for
  Linux and the container test verifies startup and SQLite persistence using
  Prisma for both the pre-restart write and post-restart read.

## Browser walkthrough

### Black and orange UI refresh

The refreshed interface was inspected in the signed-in app at a 1920px desktop
viewport and at 390px mobile width. No horizontal overflow was detected. The
meeting library, notes, editor/cancel flow, capture dialog, matters, matter
dialog, and integrations were checked. Sign-in was inspected separately with
Clerk at desktop and mobile sizes without signing the active account out.

The UI uses black navigation, neutral surfaces, and `#FF4824` accents with dark
button text. Shared CSS tokens control colors and radii. Repeated workspace/MVP
badges, stat cards, decorative panels, duplicate actions, and technical setup
copy were removed. Sample meetings and disconnected integrations remain clearly
identified where that affects the user's next action.

`desktop.jpg`, `mobile.jpg`, `login.jpg`, and `login-mobile.jpg` show the
refreshed design. The 35-test suite, type checks, and production build pass.
Browser checks did not submit recordings, change saved records, or request
microphone access.

The original meeting workflow was verified locally against the built React app
served by Deno:

- Created a fictional example from the dialog, and observed completed notes.
- Edited and saved the summary.
- Searched the transcript for “inspection” and verified only matching speaker
  turns remained.
- Added and saved personal notes.
- Selected a matter, confirmed review, and saved a file note plus a six-minute
  mock time entry.
- Confirmed the saved status and disabled editing controls.
- Created a new matter and verified integration status and service setup
  instructions.
- Searched the mobile library and completed an action item from the mobile
  review view.
- Uploaded a generated one-second WAV through the file picker, verified duration
  detection, and observed an explicit mock result with an audio player.

Responsive layout was inspected at 390px and 1440px widths with no horizontal
document overflow. The screenshots in this directory show the local UI with
fictional sample data.

## Live Clerk verification

With the user's development keys configured locally:

- The live Clerk widget loaded with **Continue with Google** enabled.
- The user completed Google authentication in the browser.
- The private workspace loaded with the signed-in account and three fictional
  sample meetings, confirming the live backend accepted the session token.
- The sidebar **Sign out** returned to the login screen and removed the meeting
  workspace.
- Build output was scanned to confirm the Clerk secret key was absent. `.env`,
  local data, and browser session material are excluded from the archive.

Authenticated audio storage/access and user isolation are covered by HTTP tests;
the new Clerk-protected microphone/upload workflow has not been repeated
end-to-end in the live user session. Clerk production configuration has not been
deployed.

## Not verified with a live service

- AssemblyAI paid transcription/Gateway: no API key was supplied. Contract tests
  mock HTTP responses.
- Microphone capture in the browser: no permission was requested to access the
  user's microphone. Audio upload/storage is tested through HTTP; recording
  controls use standard MediaRecorder APIs.
- Clio: intentionally a local mock, with no real OAuth or external writes.
- Live Railway deployment: configuration is prepared, but no account project has
  been linked or deployed from this workspace.
- Live R2 access: no bucket credentials were provided; HTTP contract tests use
  mocked responses.
