import { describe, expect, it, vi } from "vitest";
import { BuildingsService } from "./buildings.service.js";

describe("BuildingsService", () => {
  it("is defined", () => {
    const prisma = {
      building: {
        findMany: vi.fn(),
        create: vi.fn(),
      },
    };

    const service = new BuildingsService(prisma as never);

    expect(service).toBeDefined();
  });

  it("lists buildings through Prisma", async () => {
    const buildings = [{ id: "1", name: "Demo Building" }];
    const findMany = vi.fn().mockResolvedValue(buildings);

    const prisma = {
      building: {
        findMany,
        create: vi.fn(),
      },
    };

    const service = new BuildingsService(prisma as never);

    await expect(service.findAll()).resolves.toEqual(buildings);
    expect(findMany).toHaveBeenCalledOnce();
  });
});
