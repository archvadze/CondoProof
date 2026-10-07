import assert from "node:assert/strict";
import test from "node:test";
import { handleBackend } from "../src/lib/backend-proxy.ts";

async function probe(apiOrigin, webOrigin = "https://condoproof.space") {
  const previousApi = process.env.CONDOPROOF_API_ORIGIN;
  const previousWeb = process.env.CONDOPROOF_WEB_ORIGIN;
  process.env.CONDOPROOF_API_ORIGIN = apiOrigin;
  process.env.CONDOPROOF_WEB_ORIGIN = webOrigin;
  let calls = 0;
  try {
    const response = await handleBackend(
      new Request("https://condoproof.space/api/backend/buildings"),
      ["buildings"],
      undefined,
      async (url) => {
        calls += 1;
        assert.equal(String(url), `${apiOrigin}/buildings`);
        return Response.json([]);
      },
    );
    return { status: response.status, calls };
  } finally {
    if (previousApi === undefined) delete process.env.CONDOPROOF_API_ORIGIN;
    else process.env.CONDOPROOF_API_ORIGIN = previousApi;
    if (previousWeb === undefined) delete process.env.CONDOPROOF_WEB_ORIGIN;
    else process.env.CONDOPROOF_WEB_ORIGIN = previousWeb;
  }
}

test("allows the exact internal Docker API origin", async () => {
  assert.deepEqual(await probe("http://api:3011"), { status: 200, calls: 1 });
});

test("preserves loopback API access", async () => {
  assert.deepEqual(await probe("http://127.0.0.1:3011"), { status: 200, calls: 1 });
});

test("rejects other insecure upstream origins", async () => {
  for (const value of [
    "http://api:3012",
    "http://api",
    "http://example.com:3011",
    "http://138.2.173.60:3011",
    "http://user:password@api:3011",
    "http://api:3011/private",
    "http://api:3011/?target=other",
  ]) {
    assert.deepEqual(await probe(value), { status: 503, calls: 0 });
  }
});

test("does not allow the Docker exception for the public web origin", async () => {
  assert.deepEqual(
    await probe("http://api:3011", "http://api:3011"),
    { status: 503, calls: 0 },
  );
});
