import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module.js";
import { BuildingDataController } from "./building-data.controller.js";
import { BuildingDataService } from "./building-data.service.js";

@Module({
  imports: [PrismaModule],
  controllers: [BuildingDataController],
  providers: [BuildingDataService],
})
export class BuildingDataModule {}
