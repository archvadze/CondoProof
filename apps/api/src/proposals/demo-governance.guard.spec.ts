import { afterEach, describe, expect, it, vi } from "vitest";
import { DemoGovernanceGuard } from "./demo-governance.guard.js";

afterEach(() => vi.unstubAllEnvs());
describe("unsigned demo guard", () => {
  it("is disabled by default", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("DEMO_GOVERNANCE_ENABLED", "false");
    expect(() => new DemoGovernanceGuard().canActivate()).toThrow();
  });
  it("allows explicit non-production demo mode", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("DEMO_GOVERNANCE_ENABLED", "true");
    expect(new DemoGovernanceGuard().canActivate()).toBe(true);
  });
  it("denies production even if the demo flag is set", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEMO_GOVERNANCE_ENABLED", "true");
    expect(() => new DemoGovernanceGuard().canActivate()).toThrow();
  });
});
