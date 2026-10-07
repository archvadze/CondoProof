export function resolveListenHost(
  configured: string | undefined,
  demoEnabled: boolean,
): string {
  const host = configured ?? "127.0.0.1";
  if (!["127.0.0.1", "0.0.0.0"].includes(host)) {
    throw new Error("Unsupported API bind host");
  }
  if (demoEnabled && host !== "127.0.0.1") {
    throw new Error("Demo mode requires loopback binding");
  }
  return host;
}
