import { describe, expect, it, vi } from "vitest";
import { BuildingsController } from "./buildings.controller.js";

describe("BuildingsController", () => {
  it("returns buildings", async () => {
    const buildings = [{ id: "1", name: "Demo Building" }];
    const service = {
      findAll: vi.fn().mockResolvedValue(buildings),
      create: vi.fn(),
    };

    const controller = new BuildingsController(service as never);

    await expect(controller.findAll()).resolves.toEqual(buildings);
    expect(service.findAll).toHaveBeenCalledOnce();
  });
});
