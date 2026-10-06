import { Controller, Get, Param, ParseUUIDPipe } from "@nestjs/common";
import { BuildingDataService } from "./building-data.service.js";

@Controller("buildings/:buildingId")
export class BuildingDataController {
  constructor(private readonly buildingData: BuildingDataService) {}

  @Get("units")
  findUnits(@Param("buildingId", new ParseUUIDPipe()) buildingId: string) {
    return this.buildingData.findUnits(buildingId);
  }

  @Get("residents")
  findResidents(@Param("buildingId", new ParseUUIDPipe()) buildingId: string) {
    return this.buildingData.findResidents(buildingId);
  }

  @Get("services")
  findServices(@Param("buildingId", new ParseUUIDPipe()) buildingId: string) {
    return this.buildingData.findServices(buildingId);
  }
}
