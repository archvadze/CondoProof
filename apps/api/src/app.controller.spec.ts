import { describe, expect, it, vi } from "vitest";
import { AppController } from "./app.controller.js";

describe("AppController", () => {
  it("returns healthy database status", async () => {
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
    };

    const controller = new AppController(prisma as never);

    await expect(controller.health()).resolves.toEqual({
      status: "ok",
      database: "ok",
    });
  });
});
