import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { GUARDS_METADATA } from "@nestjs/common/constants.js";
import { BuildingsController } from "../buildings/buildings.controller.js";
import { CommitmentsController } from "../commitments/commitments.controller.js";
import { SignedVotingController } from "../signed-voting/signed-voting.controller.js";
import { WalletAuthController } from "../wallet-auth/wallet-auth.controller.js";
import { WalletAuthGuard } from "../wallet-auth/wallet-auth.guard.js";
import { DemoGovernanceGuard } from "./demo-governance.guard.js";
import { ProposalsController } from "./proposals.controller.js";

function guards(controller: Function, method: string): unknown[] {
  const handler = Reflect.get(controller.prototype, method);
  if (typeof handler !== "function") {
    throw new Error(`Missing handler: ${controller.name}.${method}`);
  }
  return [
    ...(Reflect.getMetadata(GUARDS_METADATA, controller) ?? []),
    ...(Reflect.getMetadata(GUARDS_METADATA, handler) ?? []),
  ];
}

describe("API authorization boundaries", () => {
  it("restricts every unsigned write and building creation to local demo mode", () => {
    for (const [controller, method] of [
      [ProposalsController, "create"],
      [ProposalsController, "castVote"],
      [CommitmentsController, "create"],
      [BuildingsController, "create"],
    ] as const) {
      expect(guards(controller, method)).toEqual([DemoGovernanceGuard]);
    }
  });

  it("keeps signed proposal actions protected by wallet authentication", () => {
    for (const method of ["create", "findOne", "message", "castVote"]) {
      expect(guards(SignedVotingController, method)).toEqual([WalletAuthGuard]);
    }
    expect(guards(CommitmentsController, "createSigned"))
      .toEqual([WalletAuthGuard]);
  });

  it("protects session identity and logout with wallet authentication", () => {
    expect(guards(WalletAuthController, "me")).toEqual([WalletAuthGuard]);
    expect(guards(WalletAuthController, "logout")).toEqual([WalletAuthGuard]);
  });

  it("allows login challenges and public evidence without the demo guard", () => {
    for (const [controller, method] of [
      [WalletAuthController, "challenge"],
      [WalletAuthController, "login"],
      [BuildingsController, "findAll"],
      [ProposalsController, "findAll"],
      [ProposalsController, "findOne"],
      [CommitmentsController, "findOne"],
      [CommitmentsController, "verification"],
      [CommitmentsController, "verifyPayload"],
    ] as const) {
      expect(guards(controller, method)).toEqual([]);
    }
  });
});
