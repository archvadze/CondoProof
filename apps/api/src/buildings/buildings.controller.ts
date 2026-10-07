import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { DemoGovernanceGuard } from "../proposals/demo-governance.guard.js";
import { BuildingsService } from "./buildings.service.js";
import { CreateBuildingDto } from "./dto/create-building.dto.js";

@Controller("buildings")
export class BuildingsController {
  constructor(private readonly buildingsService: BuildingsService) {}

  @Get()
  findAll() {
    return this.buildingsService.findAll();
  }

  @Post()
  @UseGuards(DemoGovernanceGuard)
  create(@Body() dto: CreateBuildingDto) {
    return this.buildingsService.create(dto);
  }
}
