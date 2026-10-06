BEGIN;
-- Existing votes are never deleted to make this migration pass.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "ProposalVote" GROUP BY "proposalId", "unitId" HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Existing duplicate unit votes require manual review before migration';
  END IF;
END $$;

ALTER TABLE "Proposal" ADD COLUMN "governanceSnapshot" JSONB;
ALTER TABLE "Proposal" ADD COLUMN "baseVersionId" UUID;
CREATE UNIQUE INDEX "ProposalVote_proposalId_unitId_key"
  ON "ProposalVote"("proposalId", "unitId");

-- Snapshot/identity fields become immutable once a snapshot is stored.
CREATE FUNCTION condoproof_freeze_proposal_snapshot() RETURNS trigger AS $$
BEGIN
  IF OLD."governanceSnapshot" IS NOT NULL AND (
    NEW."governanceSnapshot" IS DISTINCT FROM OLD."governanceSnapshot" OR
    NEW."baseVersionId" IS DISTINCT FROM OLD."baseVersionId" OR
    NEW."buildingId" IS DISTINCT FROM OLD."buildingId" OR
    NEW."serviceId" IS DISTINCT FROM OLD."serviceId" OR
    NEW."proposedVersionId" IS DISTINCT FROM OLD."proposedVersionId" OR
    NEW."createdByResidentId" IS DISTINCT FROM OLD."createdByResidentId" OR
    NEW.title IS DISTINCT FROM OLD.title OR
    NEW.description IS DISTINCT FROM OLD.description
  ) THEN
    RAISE EXCEPTION 'Proposal snapshot and content fields are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER condoproof_proposal_snapshot_immutable
BEFORE UPDATE ON "Proposal" FOR EACH ROW EXECUTE FUNCTION condoproof_freeze_proposal_snapshot();

-- Activation is mutable; the terms of a proposed version are immutable.
CREATE FUNCTION condoproof_freeze_proposed_version() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Proposal" WHERE "proposedVersionId" = OLD.id) AND (
    ROW(NEW.id, NEW."serviceId", NEW.version, NEW.title, NEW.description,
        NEW."monthlyAmountMinor", NEW.currency, NEW."billingPeriod", NEW."effectiveFrom", NEW."configJson")
    IS DISTINCT FROM
    ROW(OLD.id, OLD."serviceId", OLD.version, OLD.title, OLD.description,
        OLD."monthlyAmountMinor", OLD.currency, OLD."billingPeriod", OLD."effectiveFrom", OLD."configJson")
  ) THEN
    RAISE EXCEPTION 'Proposed service-version terms are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER condoproof_proposed_version_immutable
BEFORE UPDATE ON "ServiceVersion" FOR EACH ROW EXECUTE FUNCTION condoproof_freeze_proposed_version();

COMMIT;
