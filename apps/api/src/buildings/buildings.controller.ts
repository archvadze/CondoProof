import { Body, Controller, Get, Post } from "@nestjs/common";
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
  create(@Body() dto: CreateBuildingDto) {
    return this.buildingsService.create(dto);
  }
}
