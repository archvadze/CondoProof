"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiError, errorText } from "@/lib/client-api";
import { FEATURED_BUILDING, FEATURED_COMMITMENT, PROGRAM_ID, money, percent, short } from "@/lib/contracts";
import type { Building, Choice, Commitment, Proposal, Service, Unit } from "@/lib/contracts";
import { signExact } from "@/lib/phantom";
import { useWalletSession } from "./wallet-session";
interface Ballot { proposalHash: string; message: string; walletAddress: string; unitId: string; choice: Choice }
export default function Dashboard() {
  const router = useRouter();
  const wallet = useWalletSession();
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [buildingId, setBuildingId] = useState("");
  const [data, setData] = useState<{ buildingId: string; units: Unit[]; services: Service[]; proposals: Proposal[] } | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<Proposal | null>(null);
  const [membershipId, setMembershipId] = useState("");
  const [choice, setChoice] = useState<Choice>("APPROVE");
  const [ballot, setBallot] = useState<Ballot | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [serviceId, setServiceId] = useState("");
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("GEL");
  const [period, setPeriod] = useState("MONTHLY");
  const [description, setDescription] = useState("");
  const [config, setConfig] = useState("{}");
  useEffect(() => {
    let live = true;
    void api<Building[]>("/buildings").then(value => {
      if (live) { setBuildings(value); setBuildingId(value.find(b => b.id === "62871254-7b28-48c9-b333-3531e14edc9f")?.id ?? value[0]?.id ?? ""); }
    }).catch(failure => { if (live) setError(errorText(failure)); });
    return () => { live = false; };
  }, []);
  useEffect(() => {
    if (!buildingId) return;
    let live = true;
    void Promise.all([
      api<Unit[]>(`/buildings/${buildingId}/units`), api<Service[]>(`/buildings/${buildingId}/services`), api<Proposal[]>(`/buildings/${buildingId}/proposals`),
    ]).then(([units, services, proposals]) => {
      if (live) { setData({ buildingId, units, services, proposals }); setError(""); }
    }).catch(failure => { if (live) setError(errorText(failure)); });
    return () => { live = false; };
  }, [buildingId, revision]);
  const current = data?.buildingId === buildingId ? data : null;
  const building = buildings.find(b => b.id === buildingId);
  const canWrite = wallet.identity?.buildingId === buildingId;
  const members = wallet.identity?.memberships.filter(member => member.role === "OWNER") ?? [];
  const selectedMember = members.find(member => member.id === membershipId);
  const eligible = selected?.governanceSnapshot.eligibleUnits.find(unit => unit.members.some(member => member.membershipId === membershipId && member.walletAddress === wallet.identity?.walletAddress));
  const hasVoted = selected?.votes.some(vote => vote.unitId === eligible?.unitId);
  function closeReview() { setSelected(null); setBallot(null); }
  async function run(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try { await work(); } catch (failure) {
      setError(errorText(failure));
      if (failure instanceof ApiError && failure.status === 401) { wallet.expire(); setBallot(null); }
    }
    finally { setBusy(false); }
  }
  function selectBuilding(id: string) { setBuildingId(id); closeReview(); setShowForm(false); setNotice(""); setError(""); }
  function review(proposal: Proposal) {
    setSelected(proposal); setBallot(null); setChoice("APPROVE");
    const member = members.find(m => proposal.governanceSnapshot.eligibleUnits.some(u => u.members.some(v => v.membershipId === m.id && v.walletAddress === wallet.identity?.walletAddress)));
    setMembershipId(member?.id ?? "");
  }
  async function prepareBallot() {
    if (!selected || !wallet.identity || !selectedMember) return;
    const operation = wallet.requireCurrent(wallet.identity.walletAddress);
    const response = await api<Ballot>(`/buildings/${buildingId}/signed-proposals/${selected.id}/ballot-message`, { membershipId, choice });
    wallet.checkEpoch(operation, wallet.identity.walletAddress);
    const decoded = JSON.parse(response.message) as Record<string, unknown>;
    const chain = decoded.chain as { network?: string; programId?: string } | undefined;
    if (response.proposalHash !== selected.signingHash || response.walletAddress !== wallet.identity.walletAddress || response.choice !== choice || response.unitId !== selectedMember.unitId ||
        decoded.domain !== "condoproof/ballot/wallet-signed/v1" || decoded.proposalId !== selected.id || decoded.buildingId !== buildingId || decoded.membershipId !== membershipId || decoded.walletAddress !== wallet.identity.walletAddress || decoded.unitId !== selectedMember.unitId || decoded.choice !== choice || decoded.proposalHash !== selected.signingHash || chain?.network !== "solana:devnet" || chain.programId !== PROGRAM_ID) throw new Error("Ballot context does not match the reviewed proposal");
    setBallot(response);
  }
  async function submitBallot() {
    if (!selected || !wallet.identity || !ballot) return;
    const identity = wallet.identity;
    const operation = wallet.requireCurrent(identity.walletAddress);
    const signatureBase64 = await signExact(ballot.message, identity.walletAddress);
    wallet.checkEpoch(operation, identity.walletAddress);
    const updated = await api<Proposal>(`/buildings/${buildingId}/signed-proposals/${selected.id}/votes`, { membershipId, choice: ballot.choice, signatureBase64 });
    setSelected(updated); setBallot(null); setRevision(value => value + 1); setNotice(`Signed ${ballot.choice.toLowerCase()} vote recorded. Proposal: ${updated.status.toLowerCase()}.`);
  }
  async function createCommitment(proposal: Proposal) {
    if (!wallet.identity) return;
    wallet.requireCurrent(wallet.identity.walletAddress);
    const proof = await api<Commitment>(`/buildings/${buildingId}/signed-proposals/${proposal.id}/commitments`, {});
    router.push(`/verify/${proof.buildingId}/${proof.id}`);
  }
  function chooseService(id: string) {
    setServiceId(id);
    const service = current?.services.find(s => s.id === id);
    const version = service?.versions?.find(v => v.active);
    setTitle(service ? `Update ${service.name} terms` : "");
    setAmount(version ? (version.monthlyAmountMinor / 100).toFixed(2) : "100.00");
    setCurrency(version?.currency ?? "GEL"); setPeriod(version?.billingPeriod ?? "MONTHLY");
    setDescription(version?.description ?? ""); setConfig(JSON.stringify(version?.configJson ?? {}, null, 2));
  }
  async function createProposal(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      if (!wallet.identity) throw new Error("Sign in first");
      const operation = wallet.requireCurrent(wallet.identity.walletAddress);
      if (!/^\d{1,8}(?:\.\d{1,2})?$/.test(amount)) throw new Error("Enter an amount with at most two decimal places");
      const [whole, fraction = ""] = amount.split(".");
      const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
      if (minor > 2147483647) throw new Error("Amount is too large");
      const terms: unknown = JSON.parse(config);
      if (!terms || Array.isArray(terms) || typeof terms !== "object") throw new Error("Service configuration must be a JSON object");
      wallet.checkEpoch(operation, wallet.identity.walletAddress);
      const proposal = await api<Proposal>(`/buildings/${buildingId}/signed-proposals`, {
        serviceId, createdByMembershipId: membershipId, title: title.trim(), description: description.trim() || undefined,
        proposedVersion: { title: title.trim(), description: description.trim() || undefined, monthlyAmountMinor: minor, currency, billingPeriod: period, configJson: terms },
      });
      setShowForm(false); review(proposal); setRevision(value => value + 1); setNotice("Proposal created. Terms and eligible wallets are now frozen.");
    });
  }
  const unitLabel = (id: string) => current?.units.find(u => u.id === id)?.label ?? short(id);
  return <div className="app-shell">
    <aside className="sidebar"><Link href="/" className="brand"><span className="brand-mark">C</span>CondoProof<span className="beta">DEVNET</span></Link>
      <div className="nav-label">WORKSPACE</div><a className="nav-item active" href="#governance">◈ Building governance</a><Link className="nav-item" href={`/verify/${FEATURED_BUILDING}/${FEATURED_COMMITMENT}`}>◇ Verify a decision</Link>
      <div className="sidebar-note"><span className="dot" /> Signed decisions. Public evidence.<p>Terms and votes live off-chain. Their fingerprints are anchored on Solana.</p></div>
    </aside>
    <main className="workspace" id="governance"><header className="topbar"><span>BUILDING GOVERNANCE / OVERVIEW</span><div className="wallet-actions">{wallet.address && <button className="address" title="Copy public wallet address" onClick={() => { void navigator.clipboard.writeText(wallet.address).then(() => setNotice("Public wallet address copied.")).catch(failure => setError(errorText(failure))); }}>{short(wallet.address)}</button>}{wallet.identity ? <button className="button small ghost" disabled={wallet.busy} onClick={() => void wallet.logout()}>Sign out</button> : <button className="button small" disabled={wallet.busy} onClick={() => void wallet.connect()}>{wallet.busy ? "Waiting for wallet…" : "Connect Phantom"}</button>}</div></header>
      <section className="hero"><div><div className="eyebrow">A SHARED BUILDING. A VERIFIABLE DECISION.</div><h1>Know what was agreed.</h1><p>Review service terms, sign your vote, and share evidence anyone can check.</p></div><Link className="button ghost" href={`/verify/${FEATURED_BUILDING}/${FEATURED_COMMITMENT}`}>View verified demo ↗</Link></section>
      {(error || wallet.error) && <div className="alert error" role="alert">{error || wallet.error}{wallet.error.includes("not enrolled") && <p>This public wallet has not been enrolled by the building registrar. Copy its address above for enrollment.</p>}</div>}
      {notice && <div className="alert success" role="status">{notice}</div>}
      <div className="section-heading"><div><div className="eyebrow">YOUR BUILDING</div><h2>{building?.name ?? "Loading workspace…"}</h2></div><select aria-label="Choose building" value={buildingId} onChange={e => selectBuilding(e.target.value)}>{buildings.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
      {wallet.identity && wallet.identity.buildingId !== buildingId && <div className="alert">You are signed into another building. <button className="text-button" onClick={() => selectBuilding(wallet.identity!.buildingId)}>Open my building</button></div>}
      <div className="stats"><div><span>Voting units</span><strong>{current?.units.length ?? "—"}</strong><small>One ballot per eligible unit</small></div><div><span>Approval threshold</span><strong>{building ? percent(building.governanceThresholdBps) : "—"}</strong><small>Of all eligible voting weight</small></div><div><span>Quorum</span><strong>{building ? percent(building.quorumBps) : "—"}</strong><small>Minimum participating weight</small></div></div>
      <section className="section"><div className="section-heading"><h2>Building services</h2><span className="muted">Current approved terms</span></div><div className="service-grid">{current?.services.map(service => { const v = service.versions?.find(version => version.active); return <article className="service-card" key={service.id}><div className="service-icon">{service.name.slice(0, 1)}</div><span className="eyebrow">{service.category}</span><h3>{service.name}</h3>{v ? <><strong className="price">{money(v.monthlyAmountMinor, v.currency)}<small> / {v.billingPeriod.toLowerCase().replace("_", " ")}</small></strong><p>Approved version {v.version}</p></> : <p>No active version available</p>}</article>; })}</div></section>
      <section className="section"><div className="section-heading"><div><h2>Decisions & proposals</h2><p className="muted">Frozen terms. Weighted votes. Exportable evidence.</p></div><div className="actions"><button className="button ghost small" disabled={busy} onClick={() => setRevision(v => v + 1)}>Refresh</button><button className="button small" disabled={!canWrite || busy || !members.length || !current?.services.length} onClick={() => { closeReview(); setMembershipId(members[0]?.id ?? ""); chooseService(current?.services[0]?.id ?? ""); setShowForm(true); }}>New proposal +</button></div></div>
        {!wallet.identity && <p className="muted">Connect an enrolled wallet to create proposals and sign votes.</p>}
        {!current && <p className="muted">Loading building data…</p>}
        {current?.proposals.length === 0 && <div className="empty-state">No proposals yet. Start with a service change.</div>}
        <div className="proposal-list">{current?.proposals.map(p => <article className="proposal-card" key={p.id}><div className="proposal-head"><div><span className={`badge ${p.status.toLowerCase()}`}>{p.status}</span><span className="mode">{p.authorizationMode === "WALLET_SIGNED" ? "Wallet signatures" : "Legacy unsigned demo"}</span><h3>{p.title}</h3></div><button className="button small ghost" onClick={() => review(p)}>Review →</button></div><p>{p.description ?? "Review the proposed service terms and voting policy."}</p><div className="vote-progress"><span style={{ width: `${Math.min(100, p.tally.approvalWeightBps / 100)}%` }} /></div><div className="proposal-foot"><span>{percent(p.tally.approvalWeightBps)} approval / {percent(p.governanceSnapshot.governanceThresholdBps)} required</span><span>{p.tally.voteCount} votes · {percent(p.tally.participationWeightBps)} participation</span></div></article>)}</div>
      </section>
      {selected && <section className="review-panel" aria-label="Review proposal"><div className="section-heading"><div><div className="eyebrow">REVIEW BEFORE SIGNING</div><h2>{selected.title}</h2></div><button className="button ghost small" disabled={busy} onClick={closeReview}>Close</button></div><div className="review-grid"><div><h3>Proposed terms · version {selected.proposedVersion.version}</h3><p className="price">{money(selected.proposedVersion.monthlyAmountMinor, selected.proposedVersion.currency)} <small>/ {selected.proposedVersion.billingPeriod.toLowerCase()}</small></p><p>{selected.proposedVersion.description}</p><details><summary>Service configuration</summary><pre>{JSON.stringify(selected.proposedVersion.configJson, null, 2)}</pre></details><dl><dt>Approval threshold</dt><dd>{percent(selected.governanceSnapshot.governanceThresholdBps)}</dd><dt>Quorum</dt><dd>{percent(selected.governanceSnapshot.quorumBps)}</dd><dt>Proposal fingerprint</dt><dd className="hash">{selected.signingHash ?? "Unsigned demo"}</dd></dl></div><div>
        {selected.authorizationMode !== "WALLET_SIGNED" ? <div className="alert">This historical demo has no wallet-signed ballots.</div> : selected.status === "APPROVED" ? <><div className="alert success">The approval threshold and quorum were met.</div><button className="button" disabled={!canWrite || busy} onClick={() => void run(() => createCommitment(selected))}>Create / open proof →</button><p className="muted">The proof can be anchored by the authorized building operator.</p></> : selected.status !== "PENDING" ? <div className="alert">This proposal is closed: {selected.status.toLowerCase()}.</div> : !canWrite ? <div className="alert">Sign in with an eligible wallet for this building to vote.</div> : <>
          <label>Your unit<select value={membershipId} disabled={busy} onChange={e => { setMembershipId(e.target.value); setBallot(null); }}><option value="">Choose an eligible unit</option>{members.map(m => <option key={m.id} value={m.id}>Unit {unitLabel(m.unitId)}</option>)}</select></label>
          {!eligible ? <p className="muted">This membership or wallet is not in the frozen electorate.</p> : hasVoted ? <div className="alert success">Your unit has already voted.</div> : <><label>Vote<select value={choice} disabled={busy} onChange={e => { setChoice(e.target.value as Choice); setBallot(null); }}><option value="APPROVE">Approve</option><option value="REJECT">Reject</option><option value="ABSTAIN">Abstain</option></select></label><p className="muted">Unit voting weight: {percent(eligible.votingWeightBps)}. Your vote cannot be changed after submission.</p>{!ballot ? <button className="button" disabled={busy} onClick={() => void run(prepareBallot)}>Review signing message</button> : <><div className="alert">You will sign an <strong>{ballot.choice.toLowerCase()}</strong> vote for this proposal. No funds will be transferred.</div><details open><summary>Exact message sent to Phantom</summary><pre>{ballot.message}</pre></details><button className="button" disabled={busy} onClick={() => void run(submitBallot)}>{busy ? "Waiting for signature…" : `Sign ${ballot.choice.toLowerCase()} & submit`}</button></>}</>}
        </>}
      </div></div></section>}
      {showForm && <section className="review-panel"><div className="section-heading"><h2>Propose a service change</h2><button className="button ghost small" disabled={busy} onClick={() => setShowForm(false)}>Cancel</button></div><form onSubmit={event => void createProposal(event)} className="proposal-form"><label>Service<select value={serviceId} onChange={e => chooseService(e.target.value)} required>{current?.services.filter(s => s.active).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label><label>Submitting unit<select value={membershipId} onChange={e => setMembershipId(e.target.value)} required>{members.map(m => <option key={m.id} value={m.id}>Unit {unitLabel(m.unitId)}</option>)}</select></label><label className="full">Proposal / version title<input value={title} onChange={e => setTitle(e.target.value)} required maxLength={160} /></label><label>Amount per billing period<input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" required /></label><label>Currency<select value={currency} onChange={e => setCurrency(e.target.value)}><option>GEL</option><option>USD</option><option>EUR</option></select></label><label>Billing period<select value={period} onChange={e => setPeriod(e.target.value)}><option value="MONTHLY">Monthly</option><option value="WEEKLY">Weekly</option><option value="YEARLY">Yearly</option><option value="ONE_OFF">One-off</option></select></label><label className="full">Description<textarea value={description} onChange={e => setDescription(e.target.value)} maxLength={4000} rows={3} /></label><label className="full">Service configuration (JSON)<textarea className="code-input" value={config} onChange={e => setConfig(e.target.value)} rows={5} /></label><div className="full"><p className="muted">All eligible owners must have enrolled wallets. Creating the proposal freezes terms, policy and eligible wallets; your vote is a separate signature.</p><button className="button" disabled={busy || !canWrite}>{busy ? "Creating…" : "Create signed-voting proposal"}</button></div></form></section>}
      <footer>CondoProof · Solana Devnet · Enrollment is asserted by the building registrar.</footer>
    </main>
  </div>;
}
