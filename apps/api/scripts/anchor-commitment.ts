import "dotenv/config";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { Connection, Keypair, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction } from "@solana/web3.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { buildSignedApprovalPayload, verifySignedApprovalPayload } from "../src/commitments/signed-approval-payload.js";
import { approvalInclude } from "../src/commitments/approval-payload.js";
import { canonicalHash } from "../src/commitments/canonical-json.js";
import { proofContext, validBuilding, BUILDING_AUTHORITY } from "../src/solana/chain-proof.js";
import { DevnetReader, devnetRpcUrl, verifyOnChain } from "../src/solana/devnet-rpc.js";

class AnchorCheckError extends Error {}
const check: (value: unknown, message: string) => asserts value = (value, message) => { if (!value) throw new AnchorCheckError(message); };
const [id, walletPath = join(homedir(), ".config/solana/id.json")] = process.argv.slice(2);
check(id && /^[0-9a-f-]{36}$/i.test(id), "Usage: tsx scripts/anchor-commitment.ts <commitment-UUID> [local-wallet-keypair-path]");
check(process.env.NODE_ENV !== "production", "Devnet demo CLI only");
check(process.env.DATABASE_URL, "DATABASE_URL is required");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

try {
  const record = await prisma.commitment.findUnique({ where: { id } });
  check(record?.kind === "PROPOSAL" && record.proposalId, "Proposal commitment not found");
  const proposal = await prisma.proposal.findFirst({ where: { id: record.proposalId, buildingId: record.buildingId }, include: approvalInclude });
  check(proposal, "Source proposal is missing");
  const source = buildSignedApprovalPayload(proposal);
  const metadata = record.metadata as { authorizationMode?: string; payload?: unknown } | null;
  check(metadata?.authorizationMode === "WALLET_SIGNED" && verifySignedApprovalPayload(metadata.payload), "Stored proof is not a valid signed approval");
  check(canonicalHash(metadata.payload) === record.commitmentHash && source.commitmentHash === record.commitmentHash, "Stored proof/source hash mismatch");
  check(source.serviceVersionHash === proposal.proposedVersion.contentHash, "Stored service version hash mismatch");
  const context = proofContext(metadata.payload, record.commitmentHash);
  let verified = await verifyOnChain(metadata.payload, record.commitmentHash);
  check(verified.verified || verified.reason === "NOT_ANCHORED", `Chain preflight failed: ${verified.reason}`);
  let signature = record.solanaSignature;
  const reused = verified.verified;

  if (!reused) {
    // Keys are read only by this explicitly invoked local CLI, never by the Nest API.
    let numbers: unknown;
    try { numbers = JSON.parse(readFileSync(walletPath, "utf8")); }
    catch { throw new AnchorCheckError("Cannot read local wallet keypair"); }
    check(Array.isArray(numbers) && numbers.length === 64 && numbers.every(value => Number.isInteger(value) && value >= 0 && value <= 255), "Invalid local wallet keypair encoding");
    const signer = Keypair.fromSecretKey(Uint8Array.from(numbers as number[]));
    check(signer.publicKey.toBase58() === BUILDING_AUTHORITY, "Wallet is not the pinned building authority");
    const connection = new Connection(devnetRpcUrl(), {
      commitment: "finalized", confirmTransactionInitialTimeout: 60000, disableRetryOnRateLimit: true,
      fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10000), redirect: "error" }),
    });
    const reader = new DevnetReader();
    const [building] = (await reader.accounts([context.building.toBase58()])).accounts;
    const send = async (instruction: TransactionInstruction) => sendAndConfirmTransaction(
      connection, new Transaction().add(instruction), [signer], { commitment: "finalized", preflightCommitment: "finalized", maxRetries: 3 },
    );
    if (!building) {
      const instruction = new TransactionInstruction({ programId: context.program, keys: [
        { pubkey: context.building, isSigner: false, isWritable: true },
        { pubkey: signer.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ], data: Buffer.concat([createHash("sha256").update("global:initialize_building").digest().subarray(0, 8), context.buildingHash]) });
      try { await send(instruction); }
      catch {
        // Recover a concurrent successful initialization; do not trust transaction error text.
        const [existing] = (await reader.accounts([context.building.toBase58()])).accounts;
        check(validBuilding(existing ?? null, context), "Building initialization not finalized; safely rerun CLI to reconcile");
      }
    } else check(validBuilding(building, context), "Existing building account does not match authority/hash/PDA");

    const instruction = new TransactionInstruction({ programId: context.program, keys: [
      { pubkey: context.building, isSigner: false, isWritable: false },
      { pubkey: context.commitment, isSigner: false, isWritable: true },
      { pubkey: signer.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ], data: Buffer.concat([createHash("sha256").update("global:record_commitment").digest().subarray(0, 8),
      context.proposalHash, context.commitmentHash, context.serviceVersionHash]) });
    try { signature = await send(instruction); }
    catch {
      verified = await verifyOnChain(metadata.payload, record.commitmentHash);
      check(verified.verified, `Write not finalized (${verified.reason}); safely rerun CLI to reconcile`);
    }
    verified = await verifyOnChain(metadata.payload, record.commitmentHash);
  }
  check(verified.verified && verified.recordedSlot, `Finalized account verification failed: ${verified.reason}`);
  const updated = await prisma.commitment.updateMany({ where: { id: record.id, commitmentHash: source.commitmentHash },
    data: { status: "CONFIRMED", solanaSignature: signature, solanaSlot: BigInt(verified.recordedSlot) } });
  check(updated.count === 1, "Commitment changed before DB reconciliation; chain account is preserved");
  console.log(JSON.stringify({ status: "ok", commitmentId: record.id, buildingId: record.buildingId,
    reused, onChainVerified: true, solanaSignature: signature, chainVerification: verified }, null, 2));
} catch (error) {
  console.error(error instanceof AnchorCheckError ? error.message : "Devnet anchoring failed; no secret data logged. Rerun CLI to reconcile uncertain transactions.");
  process.exitCode = 1;
} finally { await prisma.$disconnect(); }
