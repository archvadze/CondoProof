import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { canonicalHash } from "../commitments/canonical-json.js";
import { verifySignedApprovalPayload } from "../commitments/signed-approval-payload.js";
import type { buildSignedApprovalPayload } from "../commitments/signed-approval-payload.js";

export const PROGRAM_ID = "3TmQGbKRSaTb1r9vabWwWPeMKEXT72AkuyDf4P2Li7gF";
export const BUILDING_AUTHORITY = "3P8pfpaCPZLhPLGysNk8m9gC4diYig7HPqh5qqYT5xoK";
export const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const PROGRAM_LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";
const tag = (name: string) => createHash("sha256").update(`account:${name}`).digest().subarray(0, 8);
export const BUILDING_TAG = tag("BuildingState");
export const COMMITMENT_TAG = tag("CommitmentState");
export type ChainAccount = { owner: string; executable: boolean; data: Buffer };
export interface ChainReader {
  genesis(): Promise<string>;
  accounts(addresses: string[]): Promise<{ slot: number; accounts: (ChainAccount | null)[] }>;
}
export type ChainReason = "VERIFIED" | "NOT_ANCHORED" | "INVALID_ACCOUNTS" | "WRONG_CLUSTER" | "RPC_UNAVAILABLE" | "UNSUPPORTED_PROOF";
export type ChainVerification = {
  verified: boolean; reason: ChainReason; network: "solana:devnet"; programId: string;
  authority: string; buildingPda?: string; commitmentPda?: string; recordedSlot?: string; readSlot?: number;
};
export type ProofContext = {
  program: PublicKey; authority: PublicKey; building: PublicKey; commitment: PublicKey;
  buildingBump: number; commitmentBump: number; buildingHash: Buffer;
  proposalHash: Buffer; commitmentHash: Buffer; serviceVersionHash: Buffer;
};
const digest = (value: string) => {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error("Invalid SHA-256 digest");
  return Buffer.from(value, "hex");
};

export function proofContext(input: unknown, expectedHash: string): ProofContext {
  if (canonicalHash(input) !== expectedHash || !verifySignedApprovalPayload(input)) throw new Error("Invalid signed approval proof");
  const payload = input as ReturnType<typeof buildSignedApprovalPayload>["payload"];
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.buildingId)) throw new Error("Invalid building UUID");
  const program = new PublicKey(PROGRAM_ID), authority = new PublicKey(BUILDING_AUTHORITY);
  const buildingHash = digest(canonicalHash({ domain: "condoproof/building/v1", buildingId: payload.buildingId }));
  const proposalHash = digest(payload.proposal.signingHash);
  const [building, buildingBump] = PublicKey.findProgramAddressSync([Buffer.from("building"), authority.toBuffer(), buildingHash], program);
  const [commitment, commitmentBump] = PublicKey.findProgramAddressSync([Buffer.from("commitment"), building.toBuffer(), proposalHash], program);
  return { program, authority, building, commitment, buildingBump, commitmentBump, buildingHash, proposalHash,
    commitmentHash: digest(expectedHash), serviceVersionHash: digest(payload.serviceVersion.contentHash) };
}

export function validBuilding(account: ChainAccount | null, expected: ProofContext): boolean {
  if (!account || account.owner !== PROGRAM_ID || account.executable || account.data.length !== 73) return false;
  const bytes = account.data;
  return bytes.subarray(0, 8).equals(BUILDING_TAG) && bytes.subarray(8, 40).equals(expected.authority.toBuffer()) &&
    bytes.subarray(40, 72).equals(expected.buildingHash) && bytes[72] === expected.buildingBump;
}

export function validateChainAccounts(expected: ProofContext, response: { slot: number; accounts: (ChainAccount | null)[] }): ChainVerification {
  const base = { network: "solana:devnet" as const, programId: PROGRAM_ID, authority: BUILDING_AUTHORITY,
    buildingPda: expected.building.toBase58(), commitmentPda: expected.commitment.toBase58(), readSlot: response.slot };
  const failure = (reason: ChainReason): ChainVerification => ({ ...base, verified: false, reason });
  if (!Number.isSafeInteger(response.slot) || response.slot < 0 || response.accounts.length !== 3) return failure("INVALID_ACCOUNTS");
  const [program, building, commitment] = response.accounts;
  if (!program || !program.executable || program.owner !== PROGRAM_LOADER) return failure("INVALID_ACCOUNTS");
  if (!building) return failure(commitment ? "INVALID_ACCOUNTS" : "NOT_ANCHORED");
  if (!validBuilding(building, expected)) return failure("INVALID_ACCOUNTS");
  if (!commitment) return failure("NOT_ANCHORED");
  if (commitment.owner !== PROGRAM_ID || commitment.executable || commitment.data.length !== 146) return failure("INVALID_ACCOUNTS");
  const data = commitment.data;
  if (!data.subarray(0, 8).equals(COMMITMENT_TAG) || data[8] !== 1 ||
      !data.subarray(9, 41).equals(expected.building.toBuffer()) ||
      !data.subarray(41, 73).equals(expected.proposalHash) ||
      !data.subarray(73, 105).equals(expected.commitmentHash) ||
      !data.subarray(105, 137).equals(expected.serviceVersionHash) || data[145] !== expected.commitmentBump) return failure("INVALID_ACCOUNTS");
  const slot = data.readBigUInt64LE(137);
  if (slot < 1n || slot > BigInt(response.slot)) return failure("INVALID_ACCOUNTS");
  return { ...base, verified: true, reason: "VERIFIED", recordedSlot: slot.toString() };
}

export async function verifyWithReader(input: unknown, expectedHash: string, reader: ChainReader): Promise<ChainVerification> {
  const base = { network: "solana:devnet" as const, programId: PROGRAM_ID, authority: BUILDING_AUTHORITY };
  let context: ProofContext;
  try { context = proofContext(input, expectedHash); }
  catch { return { ...base, verified: false, reason: "UNSUPPORTED_PROOF" }; }
  try {
    if (await reader.genesis() !== DEVNET_GENESIS) return { ...base, verified: false, reason: "WRONG_CLUSTER" };
    return validateChainAccounts(context, await reader.accounts([PROGRAM_ID, context.building.toBase58(), context.commitment.toBase58()]));
  } catch { return { ...base, verified: false, reason: "RPC_UNAVAILABLE" }; }
}
