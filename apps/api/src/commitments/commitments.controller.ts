import {
  Body, Controller, ForbiddenException, Req, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards, ValidationPipe,
} from "@nestjs/common";
import { WalletAuthGuard } from "../wallet-auth/wallet-auth.guard.js";
import type { WalletRequest } from "../wallet-auth/wallet-auth.guard.js";
import { DemoGovernanceGuard } from "../proposals/demo-governance.guard.js";
import { VerifyPayloadDto } from "./dto/verify-payload.dto.js";
import { CommitmentsService } from "./commitments.service.js";

@Controller("buildings/:buildingId")
export class CommitmentsController {
  constructor(private readonly commitments: CommitmentsService) {}

  @Post("proposals/:proposalId/commitments")
  @UseGuards(DemoGovernanceGuard)
  @HttpCode(200)
  create(
    @Param("buildingId", new ParseUUIDPipe()) buildingId: string,
    @Param("proposalId", new ParseUUIDPipe()) proposalId: string,
  ) {
    return this.commitments.create(buildingId, proposalId);
  }

  @Post("signed-proposals/:proposalId/commitments")
  @HttpCode(200)
  @UseGuards(WalletAuthGuard)
  createSigned(
    @Param("buildingId", new ParseUUIDPipe()) buildingId: string,
    @Param("proposalId", new ParseUUIDPipe()) proposalId: string,
    @Req() request: WalletRequest,
  ) {
    if (request.walletIdentity.buildingId !== buildingId) throw new ForbiddenException("Wallet belongs to another building");
    return this.commitments.create(buildingId, proposalId, "WALLET_SIGNED");
  }

  @Get("commitments/:commitmentId")
  findOne(
    @Param("buildingId", new ParseUUIDPipe()) buildingId: string,
    @Param("commitmentId", new ParseUUIDPipe()) commitmentId: string,
  ) {
    return this.commitments.findOne(buildingId, commitmentId);
  }

  @Get("commitments/:commitmentId/verification")
  verification(
    @Param("buildingId", new ParseUUIDPipe()) buildingId: string,
    @Param("commitmentId", new ParseUUIDPipe()) commitmentId: string,
  ) {
    return this.commitments.verification(buildingId, commitmentId);
  }

  @Post("commitments/:commitmentId/verify-payload")
  @HttpCode(200)
  verifyPayload(
    @Param("buildingId", new ParseUUIDPipe()) buildingId: string,
    @Param("commitmentId", new ParseUUIDPipe()) commitmentId: string,
    @Body(new ValidationPipe({ whitelist: true, transform: true })) dto: VerifyPayloadDto,
  ) {
    return this.commitments.verifyPayload(buildingId, commitmentId, dto.payload);
  }
}
