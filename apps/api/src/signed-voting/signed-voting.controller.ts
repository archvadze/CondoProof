import {
  Body, Controller, ForbiddenException, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, UseGuards,
} from "@nestjs/common";
import { DemoGovernanceGuard } from "../proposals/demo-governance.guard.js";
import { ProposalsService } from "../proposals/proposals.service.js";
import { CreateProposalDto } from "../proposals/dto/create-proposal.dto.js";
import { CastVoteDto } from "../proposals/dto/cast-vote.dto.js";
import { WalletAuthGuard } from "../wallet-auth/wallet-auth.guard.js";
import type { WalletRequest } from "../wallet-auth/wallet-auth.guard.js";
import { SignedVoteDto } from "./dto/signed-vote.dto.js";

@Controller("buildings/:buildingId/signed-proposals")
@UseGuards(DemoGovernanceGuard, WalletAuthGuard)
export class SignedVotingController {
  constructor(private readonly proposals: ProposalsService) {}

  private scope(request: WalletRequest, buildingId: string) {
    if (request.walletIdentity.buildingId !== buildingId) throw new ForbiddenException("Wallet belongs to another building");
    return request.walletIdentity;
  }

  @Post()
  create(
    @Param("buildingId", new ParseUUIDPipe()) buildingId: string,
    @Body() dto: CreateProposalDto, @Req() request: WalletRequest,
  ) {
    return this.proposals.create(buildingId, dto, this.scope(request, buildingId));
  }

  @Get(":proposalId")
  findOne(
    @Param("buildingId", new ParseUUIDPipe()) buildingId: string,
    @Param("proposalId", new ParseUUIDPipe()) proposalId: string, @Req() request: WalletRequest,
  ) {
    this.scope(request, buildingId);
    return this.proposals.findOne(buildingId, proposalId);
  }

  @Post(":proposalId/ballot-message")
  @HttpCode(200)
  message(
    @Param("buildingId", new ParseUUIDPipe()) buildingId: string,
    @Param("proposalId", new ParseUUIDPipe()) proposalId: string,
    @Body() dto: CastVoteDto, @Req() request: WalletRequest,
  ) {
    return this.proposals.ballotMessage(buildingId, proposalId, dto, this.scope(request, buildingId));
  }

  @Post(":proposalId/votes")
  castVote(
    @Param("buildingId", new ParseUUIDPipe()) buildingId: string,
    @Param("proposalId", new ParseUUIDPipe()) proposalId: string,
    @Body() dto: SignedVoteDto, @Req() request: WalletRequest,
  ) {
    return this.proposals.castVote(buildingId, proposalId, dto, this.scope(request, buildingId), dto.signatureBase64);
  }
}
