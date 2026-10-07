import { describe, expect, it } from "vitest";
import { resolveListenHost } from "./listen-host.js";

describe("API listen host", () => {
  it("defaults to loopback", () => {
    expect(resolveListenHost(undefined, false)).toBe("127.0.0.1");
  });
  it("allows an explicit container binding with demo mode disabled", () => {
    expect(resolveListenHost("0.0.0.0", false)).toBe("0.0.0.0");
  });
  it("rejects non-loopback demo binding", () => {
    expect(() => resolveListenHost("0.0.0.0", true)).toThrow();
    expect(resolveListenHost("127.0.0.1", true)).toBe("127.0.0.1");
  });
  it("rejects unsupported bind hosts", () => {
    expect(() => resolveListenHost("example.com", false)).toThrow();
  });
});
