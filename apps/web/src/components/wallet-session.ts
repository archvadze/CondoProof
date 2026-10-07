"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, errorText } from "@/lib/client-api";
import type { Identity } from "@/lib/contracts";
import { phantom, signExact } from "@/lib/phantom";
export function useWalletSession() {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const epoch = useRef(0);
  const active = useRef(false);
  const operationRunning = useRef(false);
  const ready = useRef<Promise<unknown>>(Promise.resolve());
  const revoke = useRef<Promise<unknown>>(Promise.resolve());
  const setCurrent = useCallback((value: Identity | null) => { active.current = Boolean(value); setIdentity(value); }, []);
  useEffect(() => {
    let disposed = false;
    const currentEpoch = epoch.current;
    let provider: ReturnType<typeof phantom> | undefined;
    function invalidate() {
      const hadSession = active.current;
      epoch.current++;
      setCurrent(null);
      setAddress(provider?.publicKey?.toString() ?? "");
      if (hadSession) setError("Wallet changed or disconnected. Sign in again.");
      revoke.current = revoke.current.then(() => api("/auth/logout", {})).catch(() => undefined);
    }
    try { provider = phantom(); provider.on("accountChanged", invalidate); provider.on("disconnect", invalidate); }
    catch { /* The read-only dashboard works without a wallet. */ }
    ready.current = api<Identity>("/auth/me").then(async (session) => {
      const connected = await provider?.connect({ onlyIfTrusted: true });
      if (!disposed && epoch.current === currentEpoch && connected?.publicKey.toString() === session.walletAddress) {
        setAddress(session.walletAddress); setCurrent(session);
      } else if (!disposed) { await api("/auth/logout", {}).catch(() => undefined); }
    }).catch(async (failure: unknown) => {
      if (!(failure instanceof ApiError && failure.status === 401) && !disposed) {
        await api("/auth/logout", {}).catch(() => undefined);
      }
    });
    return () => { disposed = true; provider?.removeListener("accountChanged", invalidate); provider?.removeListener("disconnect", invalidate); };
  }, [setCurrent]);
  async function connect() {
    if (operationRunning.current) return;
    operationRunning.current = true;
    setBusy(true); setError("");
    let loginCreated = false;
    try {
      await ready.current;
      await revoke.current;
      const provider = phantom();
      const connected = await provider.connect();
      await revoke.current;
      const wallet = connected.publicKey.toString();
      const operation = epoch.current;
      setAddress(wallet);
      const challenge = await api<{ challengeId: string; message: string }>("/auth/wallet/challenge", { walletAddress: wallet });
      if (!challenge.message.includes(`\nOrigin: ${window.location.origin}\n`) || !challenge.message.includes(`\nWallet: ${wallet}\n`)) throw new Error("Login origin or wallet mismatch. Check WALLET_AUTH_ORIGIN.");
      const signatureBase64 = await signExact(challenge.message, wallet);
      if (operation !== epoch.current) throw new Error("Wallet changed during login");
      await api("/auth/wallet/verify", { challengeId: challenge.challengeId, signatureBase64 });
      loginCreated = true;
      const session = await api<Identity>("/auth/me");
      if (operation !== epoch.current || provider.publicKey?.toString() !== wallet || session.walletAddress !== wallet) throw new Error("Wallet changed during login");
      setCurrent(session);
    } catch (failure) {
      setCurrent(null); setError(errorText(failure));
      if (loginCreated) await api("/auth/logout", {}).catch(() => undefined);
    } finally { operationRunning.current = false; setBusy(false); }
  }
  async function logout() {
    if (operationRunning.current) return;
    operationRunning.current = true;
    setBusy(true); setError(""); epoch.current++;
    try {
      await revoke.current;
      if (active.current) await api("/auth/logout", {}).catch((failure) => { if (!(failure instanceof ApiError && failure.status === 401)) throw failure; });
      setCurrent(null); setAddress("");
      await phantom().disconnect();
    } catch (failure) { setError(errorText(failure)); }
    finally { operationRunning.current = false; setBusy(false); }
  }
  function requireCurrent(wallet: string) {
    if (!active.current || phantom().publicKey?.toString() !== wallet) throw new Error("Wallet changed. Sign in again.");
    return epoch.current;
  }
  function checkEpoch(value: number, wallet: string) {
    if (value !== epoch.current) throw new Error("Wallet changed during this operation");
    requireCurrent(wallet);
  }
  function expire() { epoch.current++; setCurrent(null); setError("Session expired. Sign in again."); }
  return { identity, address, busy, error, connect, logout, requireCurrent, checkEpoch, expire };
}
