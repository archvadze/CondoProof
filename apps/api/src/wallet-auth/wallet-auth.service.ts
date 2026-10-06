import {
  BadRequestException, HttpException, HttpStatus, Injectable, UnauthorizedException,
} from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service.js";
import {
  sessionTokenHash, validateWalletAddress, verifyWalletSignature, walletLoginMessage,
} from "./wallet-crypto.js";

export interface WalletIdentity {
  sessionId: string;
  residentId: string;
  buildingId: string;
  walletAddress: string;
}

@Injectable()
export class WalletAuthService {
  constructor(private readonly prisma: PrismaService) {}

  async challenge(walletAddress: string) {
    try { validateWalletAddress(walletAddress); }
    catch { throw new BadRequestException("Invalid Solana public key"); }
    const configuredOrigin = process.env.WALLET_AUTH_ORIGIN ?? "http://localhost:3000";
    let origin: string;
    try {
      const url = new URL(configuredOrigin);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
          url.pathname !== "/" || url.search || url.hash) throw new Error("Invalid origin");
      origin = url.origin;
    } catch { throw new BadRequestException("WALLET_AUTH_ORIGIN must be a valid HTTP(S) origin"); }

    return this.prisma.$transaction(async (tx) => {
      const resident = await tx.resident.findUnique({ where: { walletAddress }, select: { id: true } });
      if (!resident) throw new UnauthorizedException("Wallet is not enrolled");
      await tx.$queryRaw`SELECT id FROM "Resident" WHERE id = ${resident.id}::uuid FOR UPDATE`;
      const current = await tx.resident.findUniqueOrThrow({ where: { id: resident.id } });
      if (current.walletAddress !== walletAddress) throw new UnauthorizedException("Wallet enrollment changed");
      const now = new Date();
      await tx.walletChallenge.deleteMany({
        where: { residentId: resident.id, OR: [{ expiresAt: { lte: now } }, { consumedAt: { not: null } }] },
      });
      if (await tx.walletChallenge.count({ where: { residentId: resident.id, consumedAt: null, expiresAt: { gt: now } } }) >= 5) {
        throw new HttpException("Too many active challenges; retry after expiration", HttpStatus.TOO_MANY_REQUESTS);
      }
      const expiresAt = new Date(now.getTime() + 5 * 60_000);
      const nonce = randomBytes(32).toString("hex");
      const message = walletLoginMessage({
        origin, walletAddress, buildingId: current.buildingId, nonce, issuedAt: now, expiresAt,
      });
      const challenge = await tx.walletChallenge.create({
        data: { residentId: current.id, buildingId: current.buildingId, walletAddress, origin, nonce, message, expiresAt, createdAt: now },
      });
      return { challengeId: challenge.id, message, expiresAt, signatureEncoding: "base64", messageEncoding: "utf8" };
    }, { isolationLevel: "ReadCommitted", timeout: 10000 });
  }

  async login(challengeId: string, signatureBase64: string) {
    const initial = await this.prisma.walletChallenge.findUnique({ where: { id: challengeId } });
    if (!initial || !verifyWalletSignature(initial.walletAddress, initial.message, signatureBase64)) {
      throw new UnauthorizedException("Invalid wallet signature or challenge");
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Resident" WHERE id = ${initial.residentId}::uuid FOR UPDATE`;
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "WalletChallenge" WHERE id = ${challengeId}::uuid FOR UPDATE
      `;
      if (!rows.length) throw new UnauthorizedException("Challenge is unavailable");
      const challenge = await tx.walletChallenge.findUniqueOrThrow({ where: { id: challengeId } });
      const resident = await tx.resident.findUnique({ where: { id: challenge.residentId } });
      const now = new Date();
      if (challenge.consumedAt || challenge.expiresAt <= now || !resident ||
          resident.walletAddress !== challenge.walletAddress || resident.buildingId !== challenge.buildingId ||
          challenge.message !== initial.message) {
        throw new UnauthorizedException("Challenge expired, used or enrollment changed");
      }
      const token = randomBytes(32).toString("base64url");
      const expiresAt = new Date(now.getTime() + 15 * 60_000);
      await tx.walletChallenge.update({ where: { id: challengeId }, data: { consumedAt: now } });
      await tx.walletSession.deleteMany({ where: { residentId: resident.id, expiresAt: { lte: now } } });
      await tx.walletSession.create({
        data: { residentId: resident.id, buildingId: challenge.buildingId, walletAddress: challenge.walletAddress, tokenHash: sessionTokenHash(token), expiresAt },
      });
      return { token, tokenType: "Bearer", expiresAt, residentId: resident.id, buildingId: resident.buildingId, walletAddress: challenge.walletAddress };
    }, { isolationLevel: "ReadCommitted", timeout: 10000 });
  }

  async authenticate(authorization: string | undefined): Promise<WalletIdentity> {
    const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization ?? "");
    if (!match) throw new UnauthorizedException("Wallet session is required");
    const session = await this.prisma.walletSession.findUnique({
      where: { tokenHash: sessionTokenHash(match[1]!) }, include: { resident: true },
    });
    if (!session || session.expiresAt <= new Date() || session.resident.walletAddress !== session.walletAddress ||
        session.resident.buildingId !== session.buildingId) {
      throw new UnauthorizedException("Wallet session expired or revoked");
    }
    return {
      sessionId: session.id, residentId: session.residentId,
      buildingId: session.buildingId, walletAddress: session.walletAddress,
    };
  }

  async me(identity: WalletIdentity) {
    const memberships = await this.prisma.unitResident.findMany({
      where: { residentId: identity.residentId, unit: { buildingId: identity.buildingId } },
      select: { id: true, unitId: true, role: true }, orderBy: { id: "asc" },
    });
    return { residentId: identity.residentId, buildingId: identity.buildingId, walletAddress: identity.walletAddress, memberships };
  }

  async logout(identity: WalletIdentity) {
    await this.prisma.walletSession.deleteMany({ where: { id: identity.sessionId, residentId: identity.residentId } });
    return { status: "ok" };
  }
}
