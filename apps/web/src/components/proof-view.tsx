"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, errorText } from "@/lib/client-api";
import type { Commitment, Verification } from "@/lib/contracts";
function Flag({ label, value, pending = false }: { label: string; value: boolean; pending?: boolean }) {
  return <div className={`verification-flag ${value ? "verified" : "unverified"}`}><span className="flag-icon">{value ? "✓" : "○"}</span><div><strong>{label}</strong><span>{value ? "Verified" : pending ? "Not anchored / unavailable" : "Not verified"}</span></div></div>;
}
function explorerAddress(value: string | undefined) {
  return value && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value) ? `https://explorer.solana.com/address/${value}?cluster=devnet` : null;
}
export default function ProofView({ buildingId, commitmentId }: { buildingId: string; commitmentId: string }) {
  const [proof, setProof] = useState<Commitment | null>(null);
  const [verification, setVerification] = useState<Verification | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [notice, setNotice] = useState("");
  const [checked, setChecked] = useState<{ integrityVerified: boolean; authorizationVerified: boolean; onChainVerified: boolean } | null>(null);
  const root = `/buildings/${buildingId}/commitments/${commitmentId}`;
  useEffect(() => {
    let live = true;
    void Promise.all([api<Commitment>(root), api<Verification>(`${root}/verification`)]).then(([value, status]) => {
      if (live) { setProof(value); setVerification(status); setError(""); setBusy(false); }
    }).catch(failure => { if (live) { setError(errorText(failure)); setBusy(false); } });
    return () => { live = false; };
  }, [root, refresh]);
  function download() {
    if (!proof) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(proof.payload, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `condoproof-${commitmentId}.json`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function verifyFile(file: File | undefined) {
    if (!file || busy) return;
    setBusy(true); setError(""); setChecked(null);
    try {
      if (file.size > 500000) throw new Error("JSON proof file exceeds 500 KB");
      const payload: unknown = JSON.parse(await file.text());
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("A JSON payload object is required");
      setChecked(await api(`${root}/verify-payload`, { payload }));
    } catch (failure) { setError(errorText(failure)); }
    finally { setBusy(false); }
  }
  const verified = verification?.integrityVerified && verification.authorizationVerified && verification.onChainVerified;
  const chain = verification?.chainVerification;
  const links = [{ label: "Program", address: chain?.programId }, { label: "Building account", address: chain?.buildingPda }, { label: "Commitment account", address: chain?.commitmentPda }];
  const transaction = proof?.solanaSignature && /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(proof.solanaSignature) ? `https://explorer.solana.com/tx/${proof.solanaSignature}?cluster=devnet` : null;
  return <div className="proof-shell"><header className="proof-top"><Link href="/" className="brand"><span className="brand-mark">C</span>CondoProof<span className="beta">DEVNET</span></Link><Link className="button small ghost" href="/">← Building workspace</Link></header>
    <main className="proof-main"><div className="eyebrow">PUBLIC DECISION EVIDENCE</div><h1>A decision you can check.</h1><p className="lead">Verify the exact service terms, signed ballots and their Solana Devnet fingerprint.</p>
      {error && <div className="alert error" role="alert">{error}</div>}{notice && <div className="alert success" role="status">{notice}</div>}
      <section className={`proof-banner ${verified ? "valid" : "waiting"}`}><span className="proof-symbol">{verified ? "✓" : "◇"}</span><div><h2>{!verification ? "Checking evidence…" : verified ? "Signatures and Devnet evidence verified" : "Verification requires attention"}</h2><p>{!verification ? "Fetching the proof and current finalized accounts." : verification.onChainVerified ? "The stored fingerprint matches a finalized account owned by the configured Solana program." : `Chain check: ${chain?.reason ?? "unavailable"}. The proof may be awaiting anchoring, or the RPC may be unavailable.`}</p></div></section>
      <div className="verification-grid"><Flag label="Payload fingerprint" value={verification?.integrityVerified === true} /><Flag label="Signed votes & voting policy" value={verification?.authorizationVerified === true} /><Flag label="Finalized Devnet account" value={verification?.onChainVerified === true} pending /><Flag label="Real-world ownership enrollment" value={false} /></div>
      <div className="alert trust-note">Wallet signatures prove consent by the frozen eligible wallets. Ownership and enrollment are asserted by the building registrar. The Solana program accepts the authorized writer’s commitments; it does not execute the voting policy. The deployed program remains upgradeable.</div>
      <section className="evidence-card"><div className="section-heading"><h2>Evidence record</h2><span className="badge approved">SOLANA DEVNET</span></div><dl className="evidence-dl"><dt>Commitment fingerprint</dt><dd className="hash">{proof?.commitmentHash ?? "—"}</dd><dt>Proposal</dt><dd className="hash">{proof?.proposalId ?? "—"}</dd><dt>Chain-recorded slot</dt><dd>{chain?.recordedSlot ?? "—"}</dd><dt>Last account read slot</dt><dd>{chain?.readSlot ?? "—"}</dd><dt>Current database source</dt><dd>{verification ? (verification.sourceMatches ? "Matches" : "Does not match") : "—"}</dd><dt>Service version fingerprint</dt><dd>{verification ? (verification.versionHashMatches ? "Matches" : "Does not match") : "—"}</dd><dt>Authorized building writer</dt><dd className="hash">{chain?.authority ?? "—"}</dd></dl><div className="actions wrap">{links.map(({ label, address }) => { const url = explorerAddress(address); return url ? <a className="button small ghost" key={label} href={url} target="_blank" rel="noopener noreferrer">{label} ↗</a> : null; })}{transaction && <a className="button small ghost" href={transaction} target="_blank" rel="noopener noreferrer">Transaction ↗</a>}</div></section>
      <section className="evidence-card"><div className="section-heading"><div><h2>Take the proof with you</h2><p className="muted">Export the exact payload for independent signature and fingerprint verification.</p></div></div><div className="actions wrap"><button className="button" disabled={!proof} onClick={download}>Download proof JSON ↓</button><button className="button ghost" disabled={!proof} onClick={() => { if (proof) void navigator.clipboard.writeText(proof.commitmentHash).then(() => setNotice("Commitment fingerprint copied.")).catch(failure => setError(errorText(failure))); }}>Copy fingerprint</button><button className="button ghost" disabled={busy} onClick={() => { setBusy(true); setVerification(null); setRefresh(v => v + 1); }}>Recheck Devnet</button></div><details><summary>Canonical payload</summary><pre>{proof?.canonicalPayload ?? "Loading…"}</pre></details><label className="upload-label">Check an exported or modified JSON payload<input type="file" accept=".json,application/json" disabled={busy} onChange={e => { void verifyFile(e.target.files?.[0]); e.target.value = ""; }} /></label>{checked && <div className={`alert ${checked.integrityVerified && checked.authorizationVerified && checked.onChainVerified ? "success" : "error"}`} role="status">Uploaded file: fingerprint {checked.integrityVerified ? "matches" : "does not match"}; signatures / policy {checked.authorizationVerified ? "verified" : "not verified"}; Devnet {checked.onChainVerified ? "verified" : "not verified"}.</div>}</section>
      <footer>Verification reads the configured Devnet RPC. Downloaded payload verification alone does not establish chain inclusion or real-world ownership.</footer>
    </main>
  </div>;
}
