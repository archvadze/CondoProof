import test from "node:test";
import assert from "node:assert/strict";
import { handleBackend, permitted, cookieValue } from "../src/lib/backend-proxy.ts";
const id = "995bfd6b-a401-45e9-8d74-5d61acfee1af";
const token = "a".repeat(43);
const origin = "http://localhost:3000";
function request(path, body, headers = {}) {
  return new Request(`${origin}/api/backend${path}`, { method: body === undefined ? "GET" : "POST", headers: body === undefined ? headers : { Origin: origin, "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
}
function invoke(path, body, credential, fetcher, headers) {
  return handleBackend(request(path, body, headers), path.slice(1).split("/"), credential, fetcher);
}
test("allowlist denies unsigned writes, building creation, arbitrary URLs and traversal", () => {
  for (const [method, path] of [["POST", "/buildings"], ["POST", `/buildings/${id}/proposals`], ["POST", `/buildings/${id}/proposals/${id}/votes`], ["GET", "/https://evil.test"], ["GET", "/buildings/../auth/me"], ["DELETE", "/auth/me"]]) assert.equal(permitted(method, path), false);
  assert.equal(permitted("GET", `/buildings/${id}/commitments/${id}/verification`), true);
  assert.equal(permitted("POST", `/buildings/${id}/signed-proposals/${id}/votes`), true);
});
test("POST rejects absent/wrong origin and same-site cross-origin requests before forwarding", async () => {
  const never = async () => { throw new Error("must not forward"); };
  for (const headers of [{ Origin: "https://evil.test" }, { Origin: "" }, { "Sec-Fetch-Site": "same-site" }]) {
    const response = await invoke("/auth/wallet/challenge", {}, undefined, never, headers);
    assert.equal(response.status, 403);
  }
});
test("requires JSON and bounds input size", async () => {
  assert.equal((await invoke("/auth/wallet/challenge", {}, undefined, fetch, { "Content-Type": "text/plain" })).status, 415);
  assert.equal((await invoke("/auth/wallet/challenge", { data: "x".repeat(524288) }, undefined, fetch)).status, 400);
});
test("protected routes require a valid HttpOnly session credential", async () => {
  for (const credential of [undefined, "bad"]) assert.equal((await invoke("/auth/me", undefined, credential, fetch)).status, 401);
});
test("proxy forwards the cookie as bearer with no cache and no redirects", async () => {
  let seen = false;
  const response = await invoke("/auth/me", undefined, token, async (url, options) => {
    seen = true; assert.equal(url, "http://127.0.0.1:3001/auth/me");
    assert.equal(options.headers.Authorization, `Bearer ${token}`); assert.equal(options.redirect, "error"); assert.equal(options.cache, "no-store");
    return Response.json({ walletAddress: "public" });
  });
  assert.equal(seen, true); assert.equal(response.headers.get("cache-control"), "no-store, private");
});
test("login redacts bearer tokens and sets bounded HttpOnly SameSite cookie", async () => {
  const response = await invoke("/auth/wallet/verify", {}, undefined, async () => Response.json({ token, expiresAt: new Date(Date.now() + 900000).toISOString(), walletAddress: "public", residentId: id, buildingId: id }));
  assert.equal(response.status, 200); assert.equal((await response.json()).token, undefined);
  const cookie = response.headers.get("set-cookie"); assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/); assert.match(cookie, /Max-Age=8\d\d|Max-Age=900/);
  assert.ok(!cookie.includes("Domain=")); assert.match(cookieValue(token, 900, true), /Secure/);
});
test("invalid login response cannot install a session", async () => {
  const response = await invoke("/auth/wallet/verify", {}, undefined, async () => Response.json({ token: "bad", expiresAt: new Date(Date.now() + 900000).toISOString() }));
  assert.equal(response.status, 502); assert.equal(response.headers.get("set-cookie"), null);
});
test("expired/revoked session clears cookie; logout also clears", async () => {
  const response = await invoke("/auth/me", undefined, token, async () => Response.json({ message: "Expired" }, { status: 401 }));
  assert.equal(response.status, 401); assert.match(response.headers.get("set-cookie"), /Max-Age=0/);
  const logout = await invoke("/auth/logout", {}, token, async () => Response.json({ status: "ok" }));
  assert.match(logout.headers.get("set-cookie"), /Max-Age=0/);
});
test("upstream errors do not expose stack traces or internal configuration", async () => {
  const response = await invoke("/buildings", undefined, undefined, async () => Response.json({ message: "DATABASE_URL=secret" }, { status: 500 }));
  assert.equal(response.status, 500); assert.equal((await response.json()).message, "API request failed");
  const unavailable = await invoke("/buildings", undefined, undefined, async () => { throw new Error("secret"); });
  assert.equal(unavailable.status, 502); assert.ok(!(await unavailable.text()).includes("secret"));
});
test("query strings and oversized upstream responses are rejected", async () => {
  const query = await handleBackend(new Request(`${origin}/api/backend/buildings?url=evil`), ["buildings"], undefined);
  assert.equal(query.status, 404);
  const huge = await invoke("/buildings", undefined, undefined, async () => new Response("x".repeat(4 * 1024 * 1024 + 1)));
  assert.equal(huge.status, 502);
});
