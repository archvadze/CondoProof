import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";

@Injectable()
export class BuildingDataService {
  constructor(private readonly prisma: PrismaService) {}

  private async requireBuilding(buildingId: string): Promise<void> {
    const building = await this.prisma.building.findUnique({
      where: { id: buildingId },
      select: { id: true },
    });

    if (!building) {
      throw new NotFoundException("Building not found");
    }
  }

  async findUnits(buildingId: string) {
    await this.requireBuilding(buildingId);

    return this.prisma.unit.findMany({
      where: { buildingId },
      orderBy: [{ label: "asc" }, { id: "asc" }],
      select: {
        id: true,
        buildingId: true,
        label: true,
        votingWeightBps: true,
        unitResidents: {
          where: { resident: { buildingId } },
          orderBy: { id: "asc" },
          select: {
            id: true,
            residentId: true,
            role: true,
          },
        },
      },
    });
  }

  async findResidents(buildingId: string) {
    await this.requireBuilding(buildingId);

    return this.prisma.resident.findMany({
      where: { buildingId },
      orderBy: { id: "asc" },
      select: {
        id: true,
        buildingId: true,
        units: {
          where: { unit: { buildingId } },
          orderBy: { id: "asc" },
          select: {
            id: true,
            role: true,
            unit: {
              select: {
                id: true,
                label: true,
                votingWeightBps: true,
              },
            },
          },
        },
      },
    });
  }

  async findServices(buildingId: string) {
    await this.requireBuilding(buildingId);

    return this.prisma.service.findMany({
      where: { buildingId },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: {
        id: true,
        buildingId: true,
        name: true,
        category: true,
        active: true,
        versions: {
          orderBy: { version: "desc" },
          select: {
            id: true,
            version: true,
            title: true,
            description: true,
            monthlyAmountMinor: true,
            currency: true,
            billingPeriod: true,
            effectiveFrom: true,
            contentHash: true,
            active: true,
            createdAt: true,
          },
        },
      },
    });
  }
}
