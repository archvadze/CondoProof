import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { validateWalletAddress } from "../src/wallet-auth/wallet-crypto.js";

if (process.env.NODE_ENV === "production") throw new Error("This enrollment CLI is restricted to the local demo");
const [residentId, walletAddress] = process.argv.slice(2);
if (!residentId || !walletAddress || process.argv.length !== 4 ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[3457][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(residentId)) {
  throw new Error("Usage: npx tsx scripts/bind-resident-wallet.ts <resident UUID> <wallet public address>");
}
validateWalletAddress(walletAddress);
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
try {
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Resident" WHERE id = ${residentId}::uuid FOR UPDATE`;
    const resident = await tx.resident.findUniqueOrThrow({ where: { id: residentId } });
    if (resident.walletAddress && resident.walletAddress !== walletAddress) {
      throw new Error("Resident already has another wallet; automatic replacement is prohibited");
    }
    const assigned = await tx.resident.findUnique({ where: { walletAddress }, select: { id: true } });
    if (assigned && assigned.id !== residentId) throw new Error("Wallet is assigned to another resident");
    const updated = await tx.resident.update({ where: { id: residentId }, data: { walletAddress } });
    return { status: "ok", residentId: updated.id, buildingId: updated.buildingId, walletAddress: updated.walletAddress };
  });
  console.log(JSON.stringify(result, null, 2));
} finally { await prisma.$disconnect(); }
