BEGIN;
CREATE TABLE "WalletChallenge" (
  "id" UUID NOT NULL,
  "residentId" UUID NOT NULL,
  "buildingId" UUID NOT NULL,
  "walletAddress" TEXT NOT NULL,
  "origin" TEXT NOT NULL,
  "nonce" VARCHAR(64) NOT NULL,
  "message" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WalletChallenge_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "WalletSession" (
  "id" UUID NOT NULL,
  "residentId" UUID NOT NULL,
  "buildingId" UUID NOT NULL,
  "walletAddress" TEXT NOT NULL,
  "tokenHash" VARCHAR(64) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WalletSession_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WalletChallenge_nonce_key" ON "WalletChallenge"("nonce");
CREATE INDEX "WalletChallenge_residentId_expiresAt_idx" ON "WalletChallenge"("residentId", "expiresAt");
CREATE UNIQUE INDEX "WalletSession_tokenHash_key" ON "WalletSession"("tokenHash");
CREATE INDEX "WalletSession_residentId_expiresAt_idx" ON "WalletSession"("residentId", "expiresAt");
ALTER TABLE "WalletChallenge" ADD CONSTRAINT "WalletChallenge_residentId_fkey"
  FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WalletSession" ADD CONSTRAINT "WalletSession_residentId_fkey"
  FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE CASCADE ON UPDATE CASCADE;
COMMIT;
