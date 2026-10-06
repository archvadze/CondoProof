import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import type { Request } from "express";
import { WalletAuthService } from "./wallet-auth.service.js";
import type { WalletIdentity } from "./wallet-auth.service.js";

export type WalletRequest = Request & { walletIdentity: WalletIdentity };

@Injectable()
export class WalletAuthGuard implements CanActivate {
  constructor(private readonly auth: WalletAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<WalletRequest>();
    request.walletIdentity = await this.auth.authenticate(request.headers.authorization);
    return true;
  }
}
