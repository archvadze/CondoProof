import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const moduleRoot = process.env.CONDOPROOF_TEST_MODULE_ROOT;
assert.ok(moduleRoot, 'Use the supplied local-validator runner');
const require = createRequire(resolve(moduleRoot, 'package.json'));
const { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const RPC = 'http://127.0.0.1:18899';
const connection = new Connection(RPC, { commitment: 'confirmed', confirmTransactionInitialTimeout: 30000 });
const programId = new PublicKey('3TmQGbKRSaTb1r9vabWwWPeMKEXT72AkuyDf4P2Li7gF');
const idl = JSON.parse(readFileSync(resolve('target/idl/condoproof.json'), 'utf8'));
assert.equal(idl.address, programId.toBase58(), 'IDL program identity differs');
const normalized = name => name.replaceAll('_', '').toLowerCase();
const discriminator = name => createHash('sha256').update(name).digest().subarray(0, 8);
const instructionDiscriminator = (name, accounts) => {
  const instruction = idl.instructions.find(item => normalized(item.name) === normalized(name));
  assert.ok(instruction, `Missing IDL instruction: ${name}`);
  assert.deepEqual(instruction.accounts.map(item => normalized(item.name)), accounts.map(normalized));
  const expected = discriminator(`global:${name}`);
  assert.deepEqual(Buffer.from(instruction.discriminator), expected, `Unexpected discriminator: ${name}`);
  return expected;
};
const initTag = instructionDiscriminator('initialize_building', ['building', 'authority', 'system_program']);
const recordTag = instructionDiscriminator('record_commitment', ['building', 'commitment', 'authority', 'system_program']);
const accountTag = name => {
  const account = idl.accounts.find(item => normalized(item.name) === normalized(name));
  assert.ok(account, `Missing IDL account: ${name}`);
  return Buffer.from(account.discriminator);
};
const buildingTag = accountTag('BuildingState');
const commitmentTag = accountTag('CommitmentState');

const buildingPda = (authority, hash) => PublicKey.findProgramAddressSync([Buffer.from('building'), authority.toBuffer(), hash], programId);
const commitmentPda = (building, proposal) => PublicKey.findProgramAddressSync([Buffer.from('commitment'), building.toBuffer(), proposal], programId);
const initInstruction = (authority, hash, address = buildingPda(authority, hash)[0]) => new TransactionInstruction({
  programId, keys: [
    { pubkey: address, isSigner: false, isWritable: true },
    { pubkey: authority, isSigner: true, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ], data: Buffer.concat([initTag, hash]),
});
const recordInstruction = (authority, building, proposal, hash, version, address = commitmentPda(building, proposal)[0]) => new TransactionInstruction({
  programId, keys: [
    { pubkey: building, isSigner: false, isWritable: false },
    { pubkey: address, isSigner: false, isWritable: true },
    { pubkey: authority, isSigner: true, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ], data: Buffer.concat([recordTag, proposal, hash, version]),
});
const transaction = async (instruction, signer) => {
  const tx = new Transaction().add(instruction);
  return sendAndConfirmTransaction(connection, tx, [signer], { commitment: 'confirmed', preflightCommitment: 'confirmed' });
};
const simulateFailure = async (instruction, signer, code) => {
  const tx = new Transaction().add(instruction);
  tx.feePayer = signer.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash('confirmed')).blockhash;
  tx.sign(signer);
  const result = (await connection.simulateTransaction(tx)).value;
  assert.ok(result.err, 'Invalid transaction unexpectedly succeeded');
  assert.equal(result.err.InstructionError?.[1]?.Custom, code, `Wrong failure: ${JSON.stringify(result.err)}\n${result.logs?.join('\n')}`);
};
const accountBytes = async (address, length, tag) => {
  const info = await connection.getAccountInfo(address, 'confirmed');
  assert.ok(info, 'Expected program account is missing');
  assert.equal(info.owner.toBase58(), programId.toBase58());
  assert.equal(info.executable, false);
  assert.equal(info.data.length, length);
  assert.deepEqual(info.data.subarray(0, 8), tag);
  return info.data;
};
const absent = async address => assert.equal(await connection.getAccountInfo(address), null);
const program = await connection.getAccountInfo(programId);
assert.ok(program?.executable, 'Compiled program is not loaded in local validator');

const authority = Keypair.generate();
const outsider = Keypair.generate();
for (const signer of [authority, outsider]) {
  const latest = await connection.getLatestBlockhash();
  const signature = await connection.requestAirdrop(signer.publicKey, 3 * LAMPORTS_PER_SOL);
  const confirmed = await connection.confirmTransaction({ signature, ...latest }, 'confirmed');
  assert.equal(confirmed.value.err, null);
}
const firstHash = randomBytes(32), secondHash = randomBytes(32);
const [first, firstBump] = buildingPda(authority.publicKey, firstHash);
const [second] = buildingPda(authority.publicKey, secondHash);
await transaction(initInstruction(authority.publicKey, firstHash), authority);
await transaction(initInstruction(authority.publicKey, secondHash), authority);
const firstBytes = await accountBytes(first, 73, buildingTag);
assert.deepEqual(firstBytes.subarray(8, 40), authority.publicKey.toBuffer());
assert.deepEqual(firstBytes.subarray(40, 72), firstHash);
assert.equal(firstBytes[72], firstBump);
await accountBytes(second, 73, buildingTag);
assert.notEqual(first.toBase58(), second.toBase58());

// A signature from another funded key must fail the building has_one constraint.
const proposal = randomBytes(32), hash = randomBytes(32), version = randomBytes(32);
const [address, bump] = commitmentPda(first, proposal);
await simulateFailure(recordInstruction(outsider.publicKey, first, proposal, hash, version), outsider, 6000);
await absent(address);
await transaction(recordInstruction(authority.publicKey, first, proposal, hash, version), authority);
const bytes = await accountBytes(address, 146, commitmentTag);
assert.equal(bytes[8], 1);
assert.deepEqual(bytes.subarray(9, 41), first.toBuffer());
assert.deepEqual(bytes.subarray(41, 73), proposal);
assert.deepEqual(bytes.subarray(73, 105), hash);
assert.deepEqual(bytes.subarray(105, 137), version);
assert.ok(bytes.readBigUInt64LE(137) > 0n);
assert.equal(bytes[145], bump);

// An authority public key without its signature must not authorize a write.
const missingSignatureProposal = randomBytes(32);
const unsignedInstruction = recordInstruction(authority.publicKey, first, missingSignatureProposal, hash, version);
unsignedInstruction.keys[2].isSigner = false;
await simulateFailure(unsignedInstruction, outsider, 3010);
await absent(commitmentPda(first, missingSignatureProposal)[0]);

// Duplicate writes are REAL submissions with preflight disabled: verify rollback and unchanged bytes.
let duplicateNonce = 1;
async function duplicateWrite(newHash) {
  const tx = new Transaction().add(
    recordInstruction(authority.publicKey, first, proposal, newHash, version),
    // Unique transaction bytes avoid RPC deduplication of the initial successful write.
    SystemProgram.transfer({ fromPubkey: authority.publicKey, toPubkey: authority.publicKey, lamports: duplicateNonce++ }),
  );
  const latest = await connection.getLatestBlockhash('confirmed');
  tx.feePayer = authority.publicKey; tx.recentBlockhash = latest.blockhash; tx.sign(authority);
  const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 3 });
  const result = await connection.confirmTransaction({ signature, ...latest }, 'confirmed');
  assert.ok(result.value.err, 'Duplicate commitment overwrote existing state');
  assert.deepEqual(await accountBytes(address, 146, commitmentTag), bytes);
}
await duplicateWrite(hash);
await duplicateWrite(randomBytes(32));

const crossProposal = randomBytes(32);
const [wrongAddress] = commitmentPda(first, crossProposal);
await simulateFailure(recordInstruction(authority.publicKey, second, crossProposal, hash, version, wrongAddress), authority, 2006);
await absent(wrongAddress);
// Same authority/proposal can be anchored in another building without colliding.
await transaction(recordInstruction(authority.publicKey, second, proposal, hash, version), authority);
await accountBytes(commitmentPda(second, proposal)[0], 146, commitmentTag);

// Invalid digests must roll back account initialization, not leave empty proof accounts.
for (let index = 0; index < 3; index++) {
  const arguments_ = [randomBytes(32), randomBytes(32), randomBytes(32)];
  arguments_[index] = Buffer.alloc(32);
  const candidate = commitmentPda(first, arguments_[0])[0];
  const instruction = recordInstruction(authority.publicKey, first, ...arguments_);
  const tx = new Transaction().add(instruction);
  const latest = await connection.getLatestBlockhash('confirmed');
  tx.feePayer = authority.publicKey; tx.recentBlockhash = latest.blockhash; tx.sign(authority);
  const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 3 });
  const result = await connection.confirmTransaction({ signature, ...latest }, 'confirmed');
  assert.equal(result.value.err?.InstructionError?.[1]?.Custom, 6001);
  await absent(candidate);
}
const zeroBuilding = buildingPda(authority.publicKey, Buffer.alloc(32))[0];
await simulateFailure(initInstruction(authority.publicKey, Buffer.alloc(32)), authority, 6001);
await absent(zeroBuilding);
console.log(JSON.stringify({ status: 'ok', network: 'isolated local validator',
  multipleBuildings: 'separate PDAs', authorizedWrite: 'confirmed and decoded',
  unauthorizedSigner: '6000', missingAuthoritySignature: '3010', wrongBuildingPda: '2006',
  duplicateAndChangedPayload: 'rejected; stored bytes unchanged',
  zeroHashWrites: '6001; initialization rolled back',
  accountOwnerDiscriminatorHashesBumps: 'verified',
  devnetTransactions: 0, privateKeys: 'ephemeral; memory only' }, null, 2));
