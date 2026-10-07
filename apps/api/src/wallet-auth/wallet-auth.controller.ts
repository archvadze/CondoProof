import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from "@nestjs/common";
import { WalletChallengeDto } from "./dto/wallet-challenge.dto.js";
import { WalletLoginDto } from "./dto/wallet-login.dto.js";
import { WalletAuthGuard } from "./wallet-auth.guard.js";
import type { WalletRequest } from "./wallet-auth.guard.js";
import { WalletAuthService } from "./wallet-auth.service.js";

@Controller("auth")
export class WalletAuthController {
  constructor(private readonly auth: WalletAuthService) {}

  @Post("wallet/challenge") @HttpCode(200)
  challenge(@Body() dto: WalletChallengeDto) { return this.auth.challenge(dto.walletAddress); }

  @Post("wallet/verify") @HttpCode(200)
  login(@Body() dto: WalletLoginDto) { return this.auth.login(dto.challengeId, dto.signatureBase64); }

  @Get("me") @UseGuards(WalletAuthGuard)
  me(@Req() request: WalletRequest) { return this.auth.me(request.walletIdentity); }

  @Post("logout") @HttpCode(200) @UseGuards(WalletAuthGuard)
  logout(@Req() request: WalletRequest) { return this.auth.logout(request.walletIdentity); }
}
