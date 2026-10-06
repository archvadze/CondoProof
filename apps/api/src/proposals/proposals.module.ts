import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module.js";
import { ProposalsController } from "./proposals.controller.js";
import { ProposalsService } from "./proposals.service.js";
import { DemoGovernanceGuard } from "./demo-governance.guard.js";

@Module({
  imports: [PrismaModule],
  controllers: [ProposalsController],
  providers: [ProposalsService, DemoGovernanceGuard],
})
export class ProposalsModule {}
