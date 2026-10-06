import { createHash, createPublicKey, verify } from "node:crypto";

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export function decodeBase58(text: string): Buffer {
  if (!text || text.length > 128) throw new Error("Invalid base58 length");
  let value = 0n;
  for (const character of text) {
    const digit = ALPHABET.indexOf(character);
    if (digit < 0) throw new Error("Invalid base58 character");
    value = value * 58n + BigInt(digit);
  }
  const bytes: number[] = [];
  while (value > 0n) {
    bytes.push(Number(value & 255n));
    value >>= 8n;
  }
  for (let i = 0; i < text.length && text[i] === "1"; i++) bytes.push(0);
  return Buffer.from(bytes.reverse());
}

export function encodeBase58(bytes: Uint8Array): string {
  let value = 0n;
  for (const byte of bytes) value = value * 256n + BigInt(byte);
  let encoded = "";
  while (value > 0n) {
    encoded = ALPHABET[Number(value % 58n)]! + encoded;
    value /= 58n;
  }
  for (let i = 0; i < bytes.length && bytes[i] === 0; i++) encoded = "1" + encoded;
  return encoded;
}

export function validateWalletAddress(address: string): Buffer {
  const key = decodeBase58(address);
  if (key.length !== 32 || encodeBase58(key) !== address) throw new Error("Wallet must be a canonical 32-byte Solana public key");
  return key;
}

export function verifyWalletSignature(address: string, message: string, signatureBase64: string): boolean {
  try {
    const key = validateWalletAddress(address);
    const signature = Buffer.from(signatureBase64, "base64");
    if (signature.length !== 64 || signature.toString("base64") !== signatureBase64) return false;
    const publicKey = createPublicKey({ key: Buffer.concat([SPKI_PREFIX, key]), format: "der", type: "spki" });
    return verify(null, Buffer.from(message, "utf8"), publicKey, signature);
  } catch { return false; }
}

export function sessionTokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function walletLoginMessage(input: {
  origin: string; walletAddress: string; buildingId: string; nonce: string;
  issuedAt: Date; expiresAt: Date;
}): string {
  return [
    "CondoProof wallet authentication v1",
    `Origin: ${input.origin}`,
    `Wallet: ${input.walletAddress}`,
    `Building: ${input.buildingId}`,
    `Nonce: ${input.nonce}`,
    `Issued At: ${input.issuedAt.toISOString()}`,
    `Expiration Time: ${input.expiresAt.toISOString()}`,
    "Purpose: Authenticate an enrolled resident. This does not cast a vote or authorize a transaction.",
  ].join("\n");
}
