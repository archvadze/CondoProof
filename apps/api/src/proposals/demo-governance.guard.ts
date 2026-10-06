import { CanActivate, ForbiddenException, Injectable } from "@nestjs/common";

@Injectable()
export class DemoGovernanceGuard implements CanActivate {
  canActivate(): boolean {
    if (process.env.NODE_ENV === "production" ||
        process.env.DEMO_GOVERNANCE_ENABLED !== "true") {
      throw new ForbiddenException("Unsigned governance API is disabled; enable explicit local demo mode");
    }
    return true;
  }
}
