# Deploy Meet MVP on Railway

One Docker service runs Deno and serves the compiled React app. SQLite lives on
a Railway volume mounted at `/data`. Audio can live on that volume too, or in a
private Cloudflare R2 bucket. No separate database service is needed for this
demo. Source lives in `client/`, `server/`, and shared `lib/`. Keep the Railway
service root at the app root containing `Dockerfile` and `railway.json`, rather
than pointing it at the `client` or `server` subdirectory. Docker builds
`client/dist/` and starts `server/main.ts`. The backend uses Prisma with a local
SQLite driver. Docker generates the Deno client during the build and includes
its native Linux driver; no new database service or environment variable is
required. Schema initialization/legacy compatibility runs at startup after the
volume is mounted.

## 1. Connect the source

Put the contents of the `meet-mvp` folder in a GitHub repository, keeping the
included `.gitignore`. Do not upload `.env`, `.data`, `node_modules`, or build
output. Your local meetings remain on your computer; deployment creates a new
database.

In Railway, create a project and a service from that repository. If the app is
inside a larger repository, set the service **Root Directory** to the directory
containing this app's `Dockerfile` and set **Config File** to the
repository-relative path of its `railway.json`. Skip the initial deploy until
the volume and variables are set, or expect it to fail safely until they are
ready.

The included `railway.json` selects the Dockerfile, requires `/data`, configures
`/api/health`, keeps one replica, and disables sleeping. Leave build/start
command overrides empty: the Dockerfile supplies both. Background transcription
polling needs the service to stay awake.

Alternatively, from this app directory, use the Railway CLI with an existing
project/service: `railway login`, `railway link`, then `railway up` after
completing the configuration below. `.railwayignore` excludes local secrets and
recordings from CLI uploads. No Railway token belongs in application environment
variables.

## 2. Attach persistent storage and choose a domain

Create a volume attached to the app service with mount path **`/data`**. Keep a
single replica and one region. The app refuses to start on Railway without an
attached volume, or if `DATA_DIR` points outside it. Database initialization
runs at application startup, when the volume is available, rather than during
build.

Under the service's networking settings, generate a public Railway domain. Use
port **8787** if prompted for a target port. Railway's `PORT` variable takes
precedence over the default. You can also use a custom domain with HTTPS.

Railway supplies `RAILWAY_VOLUME_MOUNT_PATH` and `RAILWAY_PUBLIC_DOMAIN`; do not
create those variables manually.

## 3. Set service variables

Enter these in Railway's **Variables** panel. Use the actual keys from your
Clerk app, not the placeholder text below. Do not paste private keys into chat.

```dotenv
NODE_ENV=production
DATA_DIR=/data
APP_ORIGIN=https://your-service.up.railway.app
VITE_CLERK_PUBLISHABLE_KEY=pk_test_your_key
CLERK_SECRET_KEY=sk_test_your_key
AI_PROVIDER=mock
SEED_DEMO=true
AUDIO_STORAGE=local
```

`APP_ORIGIN` must be the exact browser origin: HTTPS, no path, query, or
wildcard. It defaults to `https://${RAILWAY_PUBLIC_DOMAIN}` if omitted. Set it
explicitly when using a custom domain. Only this origin is accepted for browser
requests and Clerk session authorization; localhost is not allowed in hosted
mode.

`VITE_CLERK_PUBLISHABLE_KEY` is public and used **at Docker build time and at
runtime**. The Dockerfile declares this single public build argument. After
changing the Clerk publishable key, rebuild/redeploy the service so React and
the backend use the same instance. `CLERK_SECRET_KEY`, AssemblyAI credentials,
and R2 credentials are runtime-only; they are never build arguments or browser
variables. The container build context uses an allowlist and excludes `.env` and
`.data` entirely.

For a test demo, start with your matching Clerk development keys. Development
accounts/settings are separate from production. For a real production instance,
use a domain you own, finish Clerk's DNS/certificate setup, configure your own
Google OAuth credentials in Clerk, and use matching `pk_live_` / `sk_live_`
keys. Keep Clerk's sign-in/sign-up destinations pointed at the hosted app as
required by your instance. Sign-in and sign-out return to `/`; no new webhook or
custom JWT template is needed.

To enable actual transcription and AI notes, replace/add:

```dotenv
AI_PROVIDER=assemblyai
ASSEMBLYAI_API_KEY=your_private_key
ASSEMBLYAI_LLM_MODEL=claude-sonnet-4-5-20250929
```

Use a funded AssemblyAI account with access to the selected LLM Gateway model.
The mock provider remains available without an API key. Example meetings always
use fictional data. `SEED_DEMO=false` skips samples for new users without
deleting existing records. Legal-software saves still use the local mock Clio
adapter.

## 4. Optional: Cloudflare R2 for audio

With `AUDIO_STORAGE=local`, the first demo can run immediately with recordings
stored at `/data/audio`. To use R2:

1. Create a private R2 bucket, for example `meet-demo-audio`, using the default
   jurisdiction. Keep the public `r2.dev` URL and public custom domains
   disabled.
2. Create R2 S3 API credentials with **Object Read & Write** permission scoped
   to this bucket. Use its Access Key ID and Secret Access Key, not a general
   Cloudflare API bearer token.
3. Set the following Railway variables and redeploy:

```dotenv
AUDIO_STORAGE=r2
R2_ACCOUNT_ID=your_32_character_cloudflare_account_id
R2_BUCKET=meet-demo-audio
R2_ACCESS_KEY_ID=your_access_key_id
R2_SECRET_ACCESS_KEY=your_secret_access_key
```

New uploads go to private R2 objects. Playback passes through the authenticated
API after checking meeting ownership. AssemblyAI reads those same private bytes
through the backend; the bucket needs no public access or browser CORS settings.
Recordings are still limited to 50 MB and buffered by the server. Direct browser
uploads and a dedicated background queue can be added for larger workloads.

Switching to R2 preserves existing recordings on the attached volume; it does
not migrate them. Keep the volume and bucket configuration stable. SQLite,
transcripts, and notes always remain on `/data`; R2 does not replace the
database. Configure volume backups in Railway. A volume protects against
redeployment, but is not itself a backup. R2 retention/deletion policies are not
automated by this MVP.

## 5. Deploy and verify

Apply the staged changes and deploy. Expected log:
`Meet listening on
0.0.0.0:<PORT>`. `/api/health` returns `{"ok":true}` without
authentication, including when Railway sends its special health-check hostname.

Open the HTTPS app, sign in, create an example, edit its notes, choose a matter,
and save. With AssemblyAI configured, upload a short recording and verify actual
transcription, notes, and playback. Sign out and confirm the workspace closes.
Restart/redeploy once, then confirm the meeting and audio are still present.
Check Railway usage after the first day; this configuration has no hard US$5
cap.

SQLite and the volume require a single running instance. Railway volume-backed
deployments have a short interruption during redeployment. Queued/transcribing
meetings resume at startup, reusing persisted transcript IDs. An interruption
between AssemblyAI accepting a new submission and its ID being persisted can
still cause a duplicate submission; reconciliation and a durable external queue
remain future production work.

## Local verification

```sh
npm ci --ignore-scripts
npm run db:generate
npm run check
npm test
npm run build
docker build --build-arg VITE_CLERK_PUBLISHABLE_KEY=pk_test_dGVzdC5jbGVyay5hY2NvdW50cy5kZXYk -t meet-mvp:railway-test .
npm run test:container
```

The container test uses dummy credentials and a disposable Docker volume. It
checks the bundled frontend, Railway health hostname, anonymous API denial,
origin/host restrictions, and SQLite survival across a container restart. It
cleans up its own container and volume. GitHub Actions runs these checks too.

## References

- [Railway Dockerfile builds and build arguments](https://docs.railway.com/builds/dockerfiles)
- [Railway configuration as code](https://docs.railway.com/config-as-code/reference)
- [Persistent volumes](https://docs.railway.com/volumes)
- [Health checks, port, and hostname](https://docs.railway.com/deployments/healthchecks)
- [Clerk production setup](https://clerk.com/docs/guides/development/deployment/production)
- [R2 S3 credentials](https://developers.cloudflare.com/r2/api/tokens/)

## AI allowance and deletion

No new Railway variables are required. Regenerate Prisma when building this
version (Docker does this automatically). Startup adds the `ai_usage` ledger and
counts existing non-example recordings once, capped at three per Clerk user.
Keep the existing `/data` volume attached so allowance and deletion markers
survive deploys. Examples remain free; failed recordings and manual retries use
a credit, and deletion does not refund it. Upgrade is a disabled mock.

The existing R2 Object Read & Write credentials also allow recording deletion. A
failed storage cleanup leaves the meeting pending deletion and supports manual
retry or startup recovery. There is no new third-party setup for these features.
