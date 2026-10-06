import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  decodeBase58, encodeBase58, sessionTokenHash, validateWalletAddress,
  verifyWalletSignature, walletLoginMessage,
} from "./wallet-crypto.js";

describe("wallet cryptography", () => {
  it("preserves base58 leading zeros", () => {
    expect(encodeBase58(Buffer.alloc(32))).toBe("1".repeat(32));
    expect(decodeBase58("1".repeat(32)).equals(Buffer.alloc(32))).toBe(true);
    const bytes = Buffer.from([0, 0, 1, 255]);
    expect(decodeBase58(encodeBase58(bytes)).equals(bytes)).toBe(true);
  });
  it("rejects non-base58 characters", () => {
    for (const text of ["0", "O", "I", "l", "", "a".repeat(129)]) {
      expect(() => decodeBase58(text)).toThrow();
    }
  });
  it("requires a 32-byte wallet public key", () => {
    expect(() => validateWalletAddress(encodeBase58(Buffer.alloc(31)))).toThrow();
    expect(validateWalletAddress(encodeBase58(Buffer.alloc(32, 42))).length).toBe(32);
  });
  it("verifies exact UTF-8 bytes with an Ed25519 wallet", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const address = encodeBase58(publicKey.export({ format: "der", type: "spki" }).subarray(-32));
    const message = "CondoProof — თბილისი";
    const signature = sign(null, Buffer.from(message, "utf8"), privateKey).toString("base64");
    expect(verifyWalletSignature(address, message, signature)).toBe(true);
    expect(verifyWalletSignature(address, message + "\n", signature)).toBe(false);
  });
  it("rejects signatures from a different wallet", () => {
    const first = generateKeyPairSync("ed25519");
    const second = generateKeyPairSync("ed25519");
    const address = encodeBase58(first.publicKey.export({ format: "der", type: "spki" }).subarray(-32));
    const signature = sign(null, Buffer.from("login"), second.privateKey).toString("base64");
    expect(verifyWalletSignature(address, "login", signature)).toBe(false);
  });
  it("requires canonical base64 and a 64-byte signature", () => {
    const keys = generateKeyPairSync("ed25519");
    const address = encodeBase58(keys.publicKey.export({ format: "der", type: "spki" }).subarray(-32));
    const signature = sign(null, Buffer.from("login"), keys.privateKey).toString("base64");
    expect(verifyWalletSignature(address, "login", signature.replace(/=+$/, ""))).toBe(false);
    expect(verifyWalletSignature(address, "login", Buffer.alloc(63).toString("base64"))).toBe(false);
  });
  it("binds authentication purpose, origin, building and nonce", () => {
    const input = {
      origin: "http://localhost:3000", walletAddress: "wallet", buildingId: "building",
      nonce: "a".repeat(64), issuedAt: new Date("2026-10-06T22:00:00Z"), expiresAt: new Date("2026-10-06T22:05:00Z"),
    };
    const message = walletLoginMessage(input);
    expect(message.includes("Origin: http://localhost:3000")).toBe(true);
    expect(message.includes("Building: building")).toBe(true);
    expect(message.includes("does not cast a vote")).toBe(true);
    expect(walletLoginMessage({ ...input, nonce: "b".repeat(64) })).not.toBe(message);
  });
  it("stores a deterministic token hash rather than the token", () => {
    const token = "opaque-session-token";
    expect(sessionTokenHash(token).length).toBe(64);
    expect(sessionTokenHash(token)).toBe(sessionTokenHash(token));
    expect(sessionTokenHash(token)).not.toBe(token);
  });
});
