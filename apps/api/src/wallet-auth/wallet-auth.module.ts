import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module.js";
import { DemoGovernanceGuard } from "../proposals/demo-governance.guard.js";
import { WalletAuthController } from "./wallet-auth.controller.js";
import { WalletAuthService } from "./wallet-auth.service.js";
import { WalletAuthGuard } from "./wallet-auth.guard.js";

@Module({
  imports: [PrismaModule], controllers: [WalletAuthController],
  providers: [WalletAuthService, WalletAuthGuard, DemoGovernanceGuard],
  exports: [WalletAuthService, WalletAuthGuard],
})
export class WalletAuthModule {}
