import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { CreateBuildingDto } from "./dto/create-building.dto.js";

@Injectable()
export class BuildingsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.building.findMany({
      orderBy: { createdAt: "desc" },
    });
  }

  create(dto: CreateBuildingDto) {
    return this.prisma.building.create({
      data: {
        name: dto.name,
        address: dto.address,
        timezone: dto.timezone ?? "Asia/Tbilisi",
        governanceThresholdBps: dto.governanceThresholdBps ?? 8000,
        quorumBps: dto.quorumBps ?? 5000,
      },
    });
  }
}
