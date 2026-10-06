import { Module } from "@nestjs/common";
import { WalletAuthModule } from "../wallet-auth/wallet-auth.module.js";
import { PrismaModule } from "../prisma/prisma.module.js";
import { DemoGovernanceGuard } from "../proposals/demo-governance.guard.js";
import { CommitmentsController } from "./commitments.controller.js";
import { CommitmentsService } from "./commitments.service.js";

@Module({
  imports: [PrismaModule, WalletAuthModule],
  controllers: [CommitmentsController],
  providers: [CommitmentsService, DemoGovernanceGuard],
})
export class CommitmentsModule {}
