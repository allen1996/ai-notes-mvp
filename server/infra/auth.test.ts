import { createClerkAuthenticator, LOCAL_ORIGINS } from "@server/infra/auth.ts";
import { AppError } from "@server/utils/errors.ts";
import { assert, equal } from "@server/utils/test-helpers.ts";

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_")
    .replace(/=+$/, "");
const encode = (value: unknown) =>
  base64url(new TextEncoder().encode(JSON.stringify(value)));

async function signingFixture(
  allowedOrigins = LOCAL_ORIGINS,
  requestUrl = "http://127.0.0.1:8787/api/meetings",
) {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const spki = new Uint8Array(
    await crypto.subtle.exportKey("spki", pair.publicKey),
  );
  const jwtKey = `-----BEGIN PUBLIC KEY-----\n${
    btoa(String.fromCharCode(...spki))
  }\n-----END PUBLIC KEY-----`;
  const authenticate = createClerkAuthenticator({
    secretKey: "sk_test_contract_key",
    publishableKey: `pk_test_${btoa("test.clerk.accounts.dev$")}`,
    jwtKey,
    allowedOrigins,
  });
  async function request(
    overrides: Record<string, unknown> = {},
    signingKey = pair.privateKey,
  ) {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: "https://test.clerk.accounts.dev",
      sub: "user_alice",
      sid: "sess_alice",
      iat: now,
      nbf: now - 5,
      exp: now + 60,
      azp: allowedOrigins[0],
      v: 2,
      ...overrides,
    };
    const input = `${encode({ alg: "RS256", typ: "JWT", kid: "test" })}.${
      encode(payload)
    }`;
    const signature = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      signingKey,
      new TextEncoder().encode(input),
    );
    return new Request(requestUrl, {
      headers: {
        authorization: `Bearer ${input}.${
          base64url(new Uint8Array(signature))
        }`,
      },
    });
  }
  return { authenticate, request };
}

async function statusError(operation: () => Promise<unknown>, status: number) {
  try {
    await operation();
  } catch (error) {
    assert(error instanceof AppError);
    equal(error.status, status);
    return;
  }
  throw new Error(`Expected HTTP ${status}`);
}

Deno.test("Clerk verifies a real signed session JWT with a public key, without network access", async () => {
  const { authenticate, request } = await signingFixture();
  equal(await authenticate(await request()), {
    userId: "user_alice",
    sessionId: "sess_alice",
  });
});

Deno.test("Clerk accepts the hosted HTTPS origin behind Railway's HTTP proxy and rejects local tokens", async () => {
  const { authenticate, request } = await signingFixture(
    ["https://meet-demo.up.railway.app"],
    "http://meet-demo.up.railway.app/api/meetings",
  );
  equal((await authenticate(await request())).userId, "user_alice");
  await statusError(
    async () => authenticate(await request({ azp: LOCAL_ORIGINS[0] })),
    401,
  );
});

Deno.test("Clerk rejects missing, forged, expired, wrong-origin, and pending session tokens", async () => {
  const { authenticate, request } = await signingFixture();
  await statusError(
    () => authenticate(new Request("http://127.0.0.1:8787/api/meetings")),
    401,
  );
  await statusError(
    () =>
      authenticate(
        new Request("http://127.0.0.1:8787/api/meetings", {
          headers: { authorization: "Bearer not-a-jwt" },
        }),
      ),
    401,
  );
  await statusError(
    async () =>
      authenticate(await request({ exp: Math.floor(Date.now() / 1000) - 60 })),
    401,
  );
  await statusError(
    async () => authenticate(await request({ azp: "https://foreign.example" })),
    401,
  );
  await statusError(
    async () => authenticate(await request({ sts: "pending" })),
    401,
  );
  const other = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  await statusError(
    async () => authenticate(await request({}, other.privateKey)),
    401,
  );
});

Deno.test("missing Clerk configuration fails closed with HTTP 503", async () => {
  const authenticate = createClerkAuthenticator({
    allowedOrigins: LOCAL_ORIGINS,
  });
  await statusError(
    () => authenticate(new Request("http://127.0.0.1:8787/api/meetings")),
    503,
  );
});
