// This module is imported only by the server Route Handler.
export const SESSION_COOKIE = "condoproof_session";
const id = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const building = `/buildings/${id}`;
const readRules = [ /^\/buildings$/, /^\/auth\/me$/, new RegExp(`^${building}/(?:units|services|proposals)$`), new RegExp(`^${building}/(?:proposals|signed-proposals)/${id}$`), new RegExp(`^${building}/commitments/${id}(?:/verification)?$`) ];
const writeRules = [ /^\/auth\/(?:wallet\/(?:challenge|verify)|logout)$/, new RegExp(`^${building}/signed-proposals$`), new RegExp(`^${building}/signed-proposals/${id}/(?:ballot-message|votes|commitments)$`), new RegExp(`^${building}/commitments/${id}/verify-payload$`) ];
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const commonHeaders = { "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff", "Content-Type": "application/json" };
export function permitted(method: string, path: string) {
  return (method === "GET" ? readRules : method === "POST" ? writeRules : []).some(rule => rule.test(path));
}
function json(data: unknown, status = 200, cookie?: string) {
  const headers = new Headers(commonHeaders);
  if (cookie) headers.set("Set-Cookie", cookie);
  return new Response(JSON.stringify(data), { status, headers });
}
function origin(value: string, upstream: boolean) {
  const url = new URL(value);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/" ||
      !(url.protocol === "https:" || (local && url.protocol === "http:"))) throw new Error("Invalid origin");
  if (upstream && !local && url.protocol !== "https:") throw new Error("HTTPS required");
  return url.origin;
}
export function cookieValue(token: string, maxAge: number, secure: boolean) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}
async function limitedText(stream: ReadableStream<Uint8Array> | null, limit: number) {
  if (!stream) return "";
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new Error("Body too large"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
export async function handleBackend(request: Request, segments: string[], token: string | undefined, fetcher: typeof fetch = fetch) {
  const path = `/${segments.join("/")}`;
  if (!permitted(request.method, path) || new URL(request.url).search) return json({ message: "Route not permitted" }, 404);
  let apiOrigin: string, webOrigin: string;
  try {
    apiOrigin = origin(process.env.CONDOPROOF_API_ORIGIN ?? "http://127.0.0.1:3001", true);
    webOrigin = origin(process.env.CONDOPROOF_WEB_ORIGIN ?? "http://localhost:3000", false);
  } catch { return json({ message: "Server origin configuration is invalid" }, 503); }
  const clear = cookieValue("", 0, webOrigin.startsWith("https:"));
  if (request.method === "POST") {
    if (request.headers.get("origin") !== webOrigin || ["cross-site", "same-site"].includes(request.headers.get("sec-fetch-site") ?? "")) {
      return json({ message: "Cross-origin request rejected" }, 403);
    }
    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return json({ message: "JSON body required" }, 415);
  }
  const needsSession = path === "/auth/me" || path === "/auth/logout" || path.includes("/signed-proposals");
  if (needsSession && (!token || !tokenPattern.test(token))) return json({ message: "Sign in with an enrolled wallet" }, 401, clear);
  let body: string | undefined;
  if (request.method === "POST") {
    try { body = await limitedText(request.body, 524288); JSON.parse(body); }
    catch { return json({ message: "Invalid JSON or body exceeds 512 KiB" }, 400); }
  }
  try {
    const response = await fetcher(`${apiOrigin}${path}`, {
      method: request.method, headers: { "Content-Type": "application/json", ...(token && tokenPattern.test(token) ? { Authorization: `Bearer ${token}` } : {}) },
      body, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(24000),
    });
    const data: unknown = JSON.parse(await limitedText(response.body, 4 * 1024 * 1024));
    if (!response.ok) {
      const raw = (data as { message?: unknown } | null)?.message;
      const message = response.status >= 500 ? "API request failed" : Array.isArray(raw) ? raw.map(String).join("; ").slice(0, 400) : typeof raw === "string" ? raw.slice(0, 400) : "Request rejected";
      return json({ message }, response.status, response.status === 401 && needsSession ? clear : undefined);
    }
    if (path === "/auth/wallet/verify") {
      const login = data as { token?: unknown; expiresAt?: unknown; walletAddress?: unknown; buildingId?: unknown; residentId?: unknown };
      const expires = typeof login.expiresAt === "string" ? Date.parse(login.expiresAt) : NaN;
      if (typeof login.token !== "string" || !tokenPattern.test(login.token) || !Number.isFinite(expires) || expires <= Date.now()) return json({ message: "Invalid authentication response" }, 502);
      const maxAge = Math.min(900, Math.floor((expires - Date.now()) / 1000));
      if (token && tokenPattern.test(token) && token !== login.token) {
        // Revoke the previous browser session after a successful replacement.
        await fetcher(`${apiOrigin}/auth/logout`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: "{}", redirect: "error", signal: AbortSignal.timeout(5000) }).catch(() => undefined);
      }
      return json({ walletAddress: login.walletAddress, buildingId: login.buildingId, residentId: login.residentId, expiresAt: login.expiresAt }, response.status, cookieValue(login.token, maxAge, webOrigin.startsWith("https:")));
    }
    return json(data, response.status, path === "/auth/logout" ? clear : undefined);
  } catch { return json({ message: "API unavailable. Check the local API server and retry." }, 502); }
}
