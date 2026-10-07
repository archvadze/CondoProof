import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { DevnetReader, devnetRpcUrl } from "./devnet-rpc.js";

describe("read-only finalized RPC transport", () => {
  it("uses finalized batched account reads and decodes bytes", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async (_url, options) => {
      const input = JSON.parse(options!.body as string);
      assert.equal(input.method, "getMultipleAccounts");
      assert.equal(input.params[1].commitment, "finalized");
      assert.equal(input.params[1].encoding, "base64");
      return new Response(JSON.stringify({ result: { context: { slot: 123 }, value: [
        { owner: "owner", executable: false, data: [Buffer.from([1, 2]).toString("base64"), "base64"] }, null,
      ] } }));
    };
    try {
      const result = await new DevnetReader("https://api.devnet.solana.com").accounts(["a", "b"]);
      assert.equal(result.slot, 123); assert.deepEqual(result.accounts[0]!.data, Buffer.from([1, 2]));
      assert.equal(result.accounts[1], null);
    } finally { globalThis.fetch = original; }
  });
  it("rejects RPC HTTP failure and error envelopes", async () => {
    const original = globalThis.fetch;
    try {
      globalThis.fetch = async () => new Response("limited", { status: 429 });
      await assert.rejects(new DevnetReader().genesis(), /RPC request failed/);
      globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: "failure" } }));
      await assert.rejects(new DevnetReader().genesis(), /RPC result unavailable/);
    } finally { globalThis.fetch = original; }
  });
  it("refuses incomplete account lists and malformed base64", async () => {
    const original = globalThis.fetch;
    try {
      for (const value of [[], [{ owner: "owner", executable: false, data: ["!bad", "base64"] }]]) {
        globalThis.fetch = async () => new Response(JSON.stringify({ result: { context: { slot: 1 }, value } }));
        await assert.rejects(new DevnetReader().accounts(["a"]));
      }
    } finally { globalThis.fetch = original; }
  });
  it("refuses plaintext and credential-bearing operator endpoints", () => {
    const old = process.env.SOLANA_RPC_URL;
    try {
      for (const url of ["http://example.com", "https://user:secret@example.com", "https://example.com/#fragment"]) {
        process.env.SOLANA_RPC_URL = url; assert.throws(() => devnetRpcUrl());
      }
    } finally {
      if (old === undefined) delete process.env.SOLANA_RPC_URL; else process.env.SOLANA_RPC_URL = old;
    }
  });
});
