import { Module } from "@nestjs/common";
import { AppController } from "./app.controller.js";
import { AppService } from "./app.service.js";
import { PrismaModule } from "./prisma/prisma.module.js";
import { BuildingsModule } from './buildings/buildings.module.js';

@Module({
  imports: [PrismaModule, BuildingsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
