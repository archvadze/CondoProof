import {
  Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards, ValidationPipe,
} from "@nestjs/common";
import { CreateProposalDto } from "./dto/create-proposal.dto.js";
import { CastVoteDto } from "./dto/cast-vote.dto.js";
import { DemoGovernanceGuard } from "./demo-governance.guard.js";
import { ProposalsService } from "./proposals.service.js";

@Controller("buildings/:buildingId/proposals")
export class ProposalsController {
  constructor(private readonly proposals: ProposalsService) {}

  @Get()
  findAll(@Param("buildingId", new ParseUUIDPipe()) buildingId: string) {
    return this.proposals.findAll(buildingId);
  }

  @Get(":proposalId")
  findOne(
    @Param("buildingId", new ParseUUIDPipe()) buildingId: string,
    @Param("proposalId", new ParseUUIDPipe()) proposalId: string,
  ) {
    return this.proposals.findOne(buildingId, proposalId);
  }

  @Post()
  @UseGuards(DemoGovernanceGuard)
  create(
    @Param("buildingId", new ParseUUIDPipe()) buildingId: string,
    @Body(new ValidationPipe({ whitelist: true, transform: true })) dto: CreateProposalDto,
  ) {
    return this.proposals.create(buildingId, dto);
  }

  @Post(":proposalId/votes")
  @UseGuards(DemoGovernanceGuard)
  castVote(
    @Param("buildingId", new ParseUUIDPipe()) buildingId: string,
    @Param("proposalId", new ParseUUIDPipe()) proposalId: string,
    @Body(new ValidationPipe({ whitelist: true, transform: true })) dto: CastVoteDto,
  ) {
    return this.proposals.castVote(buildingId, proposalId, dto);
  }
}
