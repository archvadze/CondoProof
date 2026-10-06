import { Module } from "@nestjs/common";
import { ProposalsModule } from "../proposals/proposals.module.js";
import { WalletAuthModule } from "../wallet-auth/wallet-auth.module.js";
import { DemoGovernanceGuard } from "../proposals/demo-governance.guard.js";
import { SignedVotingController } from "./signed-voting.controller.js";

@Module({
  imports: [ProposalsModule, WalletAuthModule],
  controllers: [SignedVotingController], providers: [DemoGovernanceGuard],
})
export class SignedVotingModule {}
