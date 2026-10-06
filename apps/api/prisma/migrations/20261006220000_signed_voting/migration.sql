BEGIN;
CREATE TYPE "ProposalAuthorizationMode" AS ENUM ('UNSIGNED_DEMO', 'WALLET_SIGNED');
ALTER TABLE "Proposal"
  ADD COLUMN "authorizationMode" "ProposalAuthorizationMode" NOT NULL DEFAULT 'UNSIGNED_DEMO',
  ADD COLUMN "signingHash" VARCHAR(64);
ALTER TABLE "ProposalVote"
  ADD COLUMN "walletAddress" VARCHAR(44),
  ADD COLUMN "signatureBase64" VARCHAR(88),
  ADD COLUMN "signedMessage" TEXT;
ALTER TABLE "Proposal" ADD CONSTRAINT condoproof_proposal_auth_fields CHECK (
  ("authorizationMode" = 'UNSIGNED_DEMO' AND "signingHash" IS NULL) OR
  ("authorizationMode" = 'WALLET_SIGNED' AND "signingHash" IS NOT NULL AND "signingHash" ~ '^[0-9a-f]{64}$')
);
ALTER TABLE "ProposalVote" ADD CONSTRAINT condoproof_ballot_signature_fields CHECK (
  ("walletAddress" IS NULL AND "signatureBase64" IS NULL AND "signedMessage" IS NULL) OR
  ("walletAddress" IS NOT NULL AND "signatureBase64" IS NOT NULL AND "signedMessage" IS NOT NULL)
);

CREATE OR REPLACE FUNCTION condoproof_freeze_proposal_snapshot() RETURNS trigger AS $$
BEGIN
  IF OLD."governanceSnapshot" IS NOT NULL AND (
    NEW."governanceSnapshot" IS DISTINCT FROM OLD."governanceSnapshot" OR
    NEW."baseVersionId" IS DISTINCT FROM OLD."baseVersionId" OR
    NEW."buildingId" IS DISTINCT FROM OLD."buildingId" OR
    NEW."serviceId" IS DISTINCT FROM OLD."serviceId" OR
    NEW."proposedVersionId" IS DISTINCT FROM OLD."proposedVersionId" OR
    NEW."createdByResidentId" IS DISTINCT FROM OLD."createdByResidentId" OR
    NEW."authorizationMode" IS DISTINCT FROM OLD."authorizationMode" OR
    NEW."signingHash" IS DISTINCT FROM OLD."signingHash" OR
    NEW.title IS DISTINCT FROM OLD.title OR NEW.description IS DISTINCT FROM OLD.description
  ) THEN
    RAISE EXCEPTION 'Proposal snapshot, signing hash and content fields are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION condoproof_signed_ballot_mode() RETURNS trigger AS $$
DECLARE proposal_mode "ProposalAuthorizationMode";
BEGIN
  SELECT "authorizationMode" INTO proposal_mode FROM "Proposal" WHERE id = NEW."proposalId";
  IF proposal_mode = 'WALLET_SIGNED' AND
     (NEW."walletAddress" IS NULL OR NEW."signatureBase64" IS NULL OR NEW."signedMessage" IS NULL) THEN
    RAISE EXCEPTION 'Wallet-signed proposal requires a complete signed ballot';
  END IF;
  IF proposal_mode = 'UNSIGNED_DEMO' AND
     (NEW."walletAddress" IS NOT NULL OR NEW."signatureBase64" IS NOT NULL OR NEW."signedMessage" IS NOT NULL) THEN
    RAISE EXCEPTION 'Unsigned demo proposal cannot be relabeled as a signed ballot';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER condoproof_signed_ballot_mode_check
BEFORE INSERT OR UPDATE ON "ProposalVote" FOR EACH ROW EXECUTE FUNCTION condoproof_signed_ballot_mode();

CREATE FUNCTION condoproof_freeze_signed_ballot() RETURNS trigger AS $$
BEGIN
  IF OLD."signatureBase64" IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Stored signed ballot is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER condoproof_signed_ballot_immutable
BEFORE UPDATE ON "ProposalVote" FOR EACH ROW EXECUTE FUNCTION condoproof_freeze_signed_ballot();
COMMIT;
