export interface WalletPublicKey { toString(): string }
export interface PhantomProvider {
  isPhantom: boolean;
  publicKey: WalletPublicKey | null;
  connect(options?: { onlyIfTrusted: boolean }): Promise<{ publicKey: WalletPublicKey }>;
  disconnect(): Promise<void>;
  signMessage(message: Uint8Array, display: "utf8"): Promise<{ signature: Uint8Array; publicKey: WalletPublicKey }>;
  on(event: "accountChanged" | "disconnect", listener: () => void): void;
  removeListener(event: "accountChanged" | "disconnect", listener: () => void): void;
}
declare global { interface Window { phantom?: { solana?: PhantomProvider } } }
export function phantom() {
  const provider = window.phantom?.solana;
  if (!provider?.isPhantom) throw new Error("Open this app in a browser with Phantom installed, or in the Phantom mobile browser.");
  return provider;
}
export function signatureBase64(signature: Uint8Array) {
  if (signature.length !== 64) throw new Error("Invalid wallet signature length");
  return btoa(String.fromCharCode(...signature));
}
export async function signExact(message: string, walletAddress: string) {
  const provider = phantom();
  if (provider.publicKey?.toString() !== walletAddress) throw new Error("Wallet changed. Sign in again.");
  const signed = await provider.signMessage(new TextEncoder().encode(message), "utf8");
  if (signed.publicKey.toString() !== walletAddress || provider.publicKey?.toString() !== walletAddress) throw new Error("Wallet changed during signing. Sign in again.");
  return signatureBase64(signed.signature);
}
