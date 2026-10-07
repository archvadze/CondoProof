import type { ChainAccount, ChainReader } from "./chain-proof.js";
import { verifyWithReader } from "./chain-proof.js";

export function devnetRpcUrl(): string {
  const value = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error("SOLANA_RPC_URL must be an HTTPS RPC endpoint");
  return url.toString();
}

export class DevnetReader implements ChainReader {
  constructor(private readonly url: string = devnetRpcUrl()) {}
  private async rpc(method: string, params: unknown[] = []): Promise<unknown> {
    const response = await fetch(this.url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(8000), redirect: "error",
    });
    if (!response.ok) throw new Error("RPC request failed");
    const result = await response.json() as { error?: unknown; result?: unknown };
    if (result.error || result.result === undefined) throw new Error("RPC result unavailable");
    return result.result;
  }
  async genesis(): Promise<string> {
    const value = await this.rpc("getGenesisHash");
    if (typeof value !== "string") throw new Error("Invalid genesis result");
    return value;
  }
  async accounts(addresses: string[]) {
    const result = await this.rpc("getMultipleAccounts", [addresses, { encoding: "base64", commitment: "finalized" }]) as {
      context: { slot: number }; value: ({ owner: string; executable: boolean; data: [string, string] } | null)[];
    };
    if (!Number.isSafeInteger(result.context?.slot) || !Array.isArray(result.value) || result.value.length !== addresses.length) throw new Error("Invalid account response");
    const accounts = result.value.map((item): ChainAccount | null => {
      if (!item) return null;
      if (typeof item.owner !== "string" || typeof item.executable !== "boolean" || !Array.isArray(item.data) || item.data[1] !== "base64" ||
          typeof item.data[0] !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(item.data[0])) throw new Error("Invalid encoded account");
      return { owner: item.owner, executable: item.executable, data: Buffer.from(item.data[0], "base64") };
    });
    return { slot: result.context.slot, accounts };
  }
}

export async function verifyOnChain(payload: unknown, expectedHash: string) {
  // Invalid operator configuration is reported as unavailable, never as a successful verification.
  try { return await verifyWithReader(payload, expectedHash, new DevnetReader()); }
  catch { return { verified: false, reason: "RPC_UNAVAILABLE" as const, network: "solana:devnet" as const,
    programId: "3TmQGbKRSaTb1r9vabWwWPeMKEXT72AkuyDf4P2Li7gF", authority: "3P8pfpaCPZLhPLGysNk8m9gC4diYig7HPqh5qqYT5xoK" }; }
}
