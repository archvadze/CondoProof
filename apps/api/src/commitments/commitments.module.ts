import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module.js";
import { DemoGovernanceGuard } from "../proposals/demo-governance.guard.js";
import { CommitmentsController } from "./commitments.controller.js";
import { CommitmentsService } from "./commitments.service.js";

@Module({
  imports: [PrismaModule],
  controllers: [CommitmentsController],
  providers: [CommitmentsService, DemoGovernanceGuard],
})
export class CommitmentsModule {}
