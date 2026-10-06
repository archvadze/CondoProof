import { SignedVotingModule } from "./signed-voting/signed-voting.module.js";
import { WalletAuthModule } from "./wallet-auth/wallet-auth.module.js";
import { CommitmentsModule } from "./commitments/commitments.module.js";
import { ProposalsModule } from "./proposals/proposals.module.js";
import { BuildingDataModule } from "./building-data/building-data.module.js";
import { Module } from "@nestjs/common";
import { AppController } from "./app.controller.js";
import { AppService } from "./app.service.js";
import { PrismaModule } from "./prisma/prisma.module.js";
import { BuildingsModule } from './buildings/buildings.module.js';

@Module({
  imports: [PrismaModule, BuildingsModule, BuildingDataModule, ProposalsModule, CommitmentsModule, WalletAuthModule, SignedVotingModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
