-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "VoteChoice" AS ENUM ('APPROVE', 'REJECT', 'ABSTAIN');

-- CreateEnum
CREATE TYPE "CommitmentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED');

-- CreateEnum
CREATE TYPE "CommitmentKind" AS ENUM ('PROPOSAL', 'PERIOD', 'PAYMENT_BATCH', 'SERVICE_COMPLETION');

-- CreateEnum
CREATE TYPE "BillingPeriod" AS ENUM ('MONTHLY', 'WEEKLY', 'YEARLY', 'ONE_OFF');

-- CreateTable
CREATE TABLE "Building" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Tbilisi',
    "governanceThresholdBps" INTEGER NOT NULL DEFAULT 8000,
    "quorumBps" INTEGER NOT NULL DEFAULT 5000,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Building_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Unit" (
    "id" UUID NOT NULL,
    "buildingId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "votingWeightBps" INTEGER NOT NULL DEFAULT 1000,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Resident" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "walletAddress" TEXT,
    "buildingId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Resident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnitResident" (
    "id" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "residentId" UUID NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'OWNER',

    CONSTRAINT "UnitResident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Service" (
    "id" UUID NOT NULL,
    "buildingId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Service_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceVersion" (
    "id" UUID NOT NULL,
    "serviceId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "monthlyAmountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "billingPeriod" "BillingPeriod" NOT NULL DEFAULT 'MONTHLY',
    "effectiveFrom" TIMESTAMP(3),
    "contentHash" TEXT,
    "configJson" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Proposal" (
    "id" UUID NOT NULL,
    "buildingId" UUID NOT NULL,
    "serviceId" UUID NOT NULL,
    "proposedVersionId" UUID NOT NULL,
    "createdByResidentId" UUID,
    "status" "ProposalStatus" NOT NULL DEFAULT 'PENDING',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "requiredApprovals" INTEGER NOT NULL DEFAULT 4,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Proposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProposalVote" (
    "id" UUID NOT NULL,
    "proposalId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "unitResidentId" UUID NOT NULL,
    "residentId" UUID NOT NULL,
    "choice" "VoteChoice" NOT NULL,
    "votingWeightBps" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProposalVote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" UUID NOT NULL,
    "buildingId" UUID NOT NULL,
    "serviceId" UUID NOT NULL,
    "serviceVersionId" UUID NOT NULL,
    "periodKey" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Commitment" (
    "id" UUID NOT NULL,
    "buildingId" UUID NOT NULL,
    "proposalId" UUID,
    "kind" "CommitmentKind" NOT NULL,
    "commitmentHash" TEXT NOT NULL,
    "status" "CommitmentStatus" NOT NULL DEFAULT 'PENDING',
    "solanaSignature" TEXT,
    "solanaSlot" BIGINT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Commitment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Unit_buildingId_label_key" ON "Unit"("buildingId", "label");

-- CreateIndex
CREATE UNIQUE INDEX "Resident_walletAddress_key" ON "Resident"("walletAddress");

-- CreateIndex
CREATE UNIQUE INDEX "UnitResident_unitId_residentId_key" ON "UnitResident"("unitId", "residentId");

-- CreateIndex
CREATE UNIQUE INDEX "Service_buildingId_name_key" ON "Service"("buildingId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceVersion_contentHash_key" ON "ServiceVersion"("contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceVersion_serviceId_version_key" ON "ServiceVersion"("serviceId", "version");

-- CreateIndex
CREATE INDEX "Proposal_buildingId_status_idx" ON "Proposal"("buildingId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ProposalVote_proposalId_unitResidentId_key" ON "ProposalVote"("proposalId", "unitResidentId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_buildingId_periodKey_serviceId_key" ON "Invoice"("buildingId", "periodKey", "serviceId");

-- CreateIndex
CREATE UNIQUE INDEX "Commitment_commitmentHash_key" ON "Commitment"("commitmentHash");

-- CreateIndex
CREATE INDEX "Commitment_commitmentHash_idx" ON "Commitment"("commitmentHash");

-- AddForeignKey
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resident" ADD CONSTRAINT "Resident_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitResident" ADD CONSTRAINT "UnitResident_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitResident" ADD CONSTRAINT "UnitResident_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Service" ADD CONSTRAINT "Service_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceVersion" ADD CONSTRAINT "ServiceVersion_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_proposedVersionId_fkey" FOREIGN KEY ("proposedVersionId") REFERENCES "ServiceVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_createdByResidentId_fkey" FOREIGN KEY ("createdByResidentId") REFERENCES "Resident"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalVote" ADD CONSTRAINT "ProposalVote_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalVote" ADD CONSTRAINT "ProposalVote_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalVote" ADD CONSTRAINT "ProposalVote_unitResidentId_fkey" FOREIGN KEY ("unitResidentId") REFERENCES "UnitResident"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalVote" ADD CONSTRAINT "ProposalVote_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "Resident"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_serviceVersionId_fkey" FOREIGN KEY ("serviceVersionId") REFERENCES "ServiceVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commitment" ADD CONSTRAINT "Commitment_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commitment" ADD CONSTRAINT "Commitment_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
