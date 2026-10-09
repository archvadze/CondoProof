"use client";
import Link from "next/link";
import { BrandMark } from "./brand-mark";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, ApiError, errorText } from "@/lib/client-api";
import { FEATURED_BUILDING, FEATURED_COMMITMENT, PROGRAM_ID, money, percent, short } from "@/lib/contracts";
import type { Building, Choice, Commitment, Proposal, Service, Unit } from "@/lib/contracts";
import { signExact } from "@/lib/phantom";
import { useWalletSession } from "./wallet-session";
import { UiIcon } from "./ui-icon";
interface Ballot { proposalHash: string; message: string; walletAddress: string; unitId: string; choice: Choice }
export default function Dashboard() {
  const router = useRouter();
  const wallet = useWalletSession();
  const running = useRef(false);
  const reviewRef = useRef<HTMLElement>(null);
  const [buildingsLoading, setBuildingsLoading] = useState(true);
  const [buildingAttempt, setBuildingAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"ALL" | "PENDING" | "APPROVED">("ALL");
  const [actionPhase, setActionPhase] = useState("");
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
    }).catch(failure => { if (live) setError(errorText(failure)); })
      .finally(() => { if (live) setBuildingsLoading(false); });
    return () => { live = false; };
  }, [buildingAttempt]);
  useEffect(() => {
    if (!buildingId) return;
    let live = true;
    void Promise.all([
      api<Unit[]>(`/buildings/${buildingId}/units`), api<Service[]>(`/buildings/${buildingId}/services`), api<Proposal[]>(`/buildings/${buildingId}/proposals`),
    ]).then(([units, services, proposals]) => {
      if (live) { setData({ buildingId, units, services, proposals }); setError(""); }
    }).catch(failure => { if (live) setError(errorText(failure)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [buildingId, revision]);
  useEffect(() => {
    if (selected || showForm) {
      reviewRef.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" });
      reviewRef.current?.focus({ preventScroll: true });
    }
  }, [selected, showForm]);
  const current = data?.buildingId === buildingId ? data : null;
  const building = buildings.find(b => b.id === buildingId);
  const canWrite = wallet.identity?.buildingId === buildingId;
  const members = wallet.identity?.memberships.filter(member => member.role === "OWNER") ?? [];
  const selectedMember = members.find(member => member.id === membershipId);
  const eligible = selected?.governanceSnapshot.eligibleUnits.find(unit => unit.members.some(member => member.membershipId === membershipId && member.walletAddress === wallet.identity?.walletAddress));
  const hasVoted = selected?.votes.some(vote => vote.unitId === eligible?.unitId);
  function closeReview() { setSelected(null); setBallot(null); }
  async function run(work: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setBusy(true); setError(""); setNotice("");
    try { await work(); } catch (failure) {
      setError(errorText(failure));
      if (failure instanceof ApiError && failure.status === 401) { wallet.expire(); setBallot(null); }
    }
    finally { running.current = false; setBusy(false); setActionPhase(""); }
  }
  function refreshData() { setLoading(true); setRevision(value => value + 1); }
  function retryData() { setError(""); if (!buildings.length) { setBuildingsLoading(true); setBuildingAttempt(value => value + 1); } else refreshData(); }
  function openForm() { closeReview(); setMembershipId(members[0]?.id ?? ""); chooseService(current?.services.find(service => service.active)?.id ?? ""); setShowForm(true); }
  function selectBuilding(id: string) { if (id !== buildingId) setLoading(true); setFilter("ALL"); setBuildingId(id); closeReview(); setShowForm(false); setNotice(""); setError(""); }
  function review(proposal: Proposal) {
    setShowForm(false); setSelected(proposal); setBallot(null); setChoice("APPROVE");
    const member = members.find(m => proposal.governanceSnapshot.eligibleUnits.some(u => u.members.some(v => v.membershipId === m.id && v.walletAddress === wallet.identity?.walletAddress)));
    setMembershipId(member?.id ?? "");
  }
  async function prepareBallot() {
    if (!selected || !wallet.identity || !selectedMember) return;
    const operation = wallet.requireCurrent(wallet.identity.walletAddress);
    setActionPhase("Preparing the exact ballot…");
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
    setActionPhase("Waiting for Phantom signature…");
    const signatureBase64 = await signExact(ballot.message, identity.walletAddress);
    wallet.checkEpoch(operation, identity.walletAddress);
    setActionPhase("Recording your signed ballot…");
    const updated = await api<Proposal>(`/buildings/${buildingId}/signed-proposals/${selected.id}/votes`, { membershipId, choice: ballot.choice, signatureBase64 });
    setSelected(updated); setBallot(null); setRevision(value => value + 1); setNotice(`Signed ${ballot.choice.toLowerCase()} vote recorded. Proposal: ${updated.status.toLowerCase()}.`);
  }
  async function createCommitment(proposal: Proposal) {
    if (!wallet.identity) return;
    const identity = wallet.identity;
    const operation = wallet.requireCurrent(identity.walletAddress);
    setActionPhase("Preparing your decision evidence…");
    const proof = await api<Commitment>(`/buildings/${buildingId}/signed-proposals/${proposal.id}/commitments`, {});
    wallet.checkEpoch(operation, identity.walletAddress);
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
      setActionPhase("Creating the frozen proposal…");
      const proposal = await api<Proposal>(`/buildings/${buildingId}/signed-proposals`, {
        serviceId, createdByMembershipId: membershipId, title: title.trim(), description: description.trim() || undefined,
        proposedVersion: { title: title.trim(), description: description.trim() || undefined, monthlyAmountMinor: minor, currency, billingPeriod: period, configJson: terms },
      });
      setShowForm(false); review(proposal); setRevision(value => value + 1); setNotice("Proposal created. Terms and eligible wallets are now frozen.");
    });
  }
  const unitLabel = (id: string) => current?.units.find(u => u.id === id)?.label ?? short(id);
  const filteredProposals = current?.proposals.filter(proposal => filter === "ALL" || proposal.status === filter) ?? [];
  const isLoading = buildingsLoading || (Boolean(buildingId) && loading);
  return <div className="app-shell dashboard-shell">
    <header className="app-header"><Link href="/" className="brand"><BrandMark />CondoProof</Link>
      <nav className="app-nav" aria-label="Workspace"><a className="active" href="#governance">Governance</a><Link href={`/verify/${FEATURED_BUILDING}/${FEATURED_COMMITMENT}`}>Verification</Link></nav>
      <div className="wallet-actions">{wallet.address && <div className="wallet-chip"><UiIcon name="wallet" /><span>{short(wallet.address)}</span><button className="icon-button" aria-label="Copy public wallet address" onClick={() => { void navigator.clipboard.writeText(wallet.address).then(() => setNotice("Public wallet address copied.")).catch(failure => setError(errorText(failure))); }}><UiIcon name="copy" /></button></div>}{wallet.identity ? <button className="button small ghost" disabled={wallet.busy || busy} onClick={() => void wallet.logout()}>Sign out</button> : <button className="button small" disabled={wallet.busy || busy} onClick={() => void wallet.connect()}>{wallet.busy ? "Waiting for wallet…" : "Connect Phantom"}</button>}</div>
    </header>
    <main className="workspace" id="governance"><section className="hero"><div><div className="eyebrow">YOUR COMMUNITY, YOUR DECISIONS</div><h1>A shared place.<br />A clear agreement.</h1><p>Review the terms. Sign your vote.<br />Keep a decision everyone can check.</p></div><button className="button" disabled={!canWrite || busy || !members.length || !current?.services.some(service => service.active)} onClick={openForm}><UiIcon name="plus" />New proposal</button></section>
      {(error || wallet.error) && <div className="alert error" role="alert">{error || wallet.error}{error && <button className="button small ghost" disabled={isLoading || busy} onClick={retryData}>Retry</button>}{wallet.error.includes("not enrolled") && <p>This public wallet has not been enrolled by the building registrar. Copy its address above for enrollment.</p>}</div>}
      {notice && <div className="alert success" role="status">{notice}</div>}
      <div className="community-card"><div className="community-heading"><span className="community-icon"><UiIcon name="house" /></span><div><h2>{building?.name ?? (buildingsLoading ? "Loading your community…" : "No communities available")}</h2><label className="community-picker">Community<select aria-label="Choose community" disabled={busy || buildingsLoading || !buildings.length} value={buildingId} onChange={e => selectBuilding(e.target.value)}>{!buildings.length && <option value="">No communities available</option>}{buildings.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label></div></div>
      {wallet.identity && wallet.identity.buildingId !== buildingId && <div className="alert">You are signed into another building. <button className="text-button" onClick={() => selectBuilding(wallet.identity!.buildingId)}>Open my building</button></div>}
      <div className="stats"><div><span>Voting units</span><strong>{current?.units.length ?? "—"}</strong><small>One ballot per eligible unit</small></div><div><span>Approval threshold</span><strong>{building ? percent(building.governanceThresholdBps) : "—"}</strong><small>Of all eligible voting weight</small></div><div><span>Quorum</span><strong>{building ? percent(building.quorumBps) : "—"}</strong><small>Minimum participating weight</small></div></div></div>
      <section className="section"><div className="section-heading"><h2>Building services</h2><span className="muted">Current approved terms</span></div><div className="service-grid">{isLoading && !current && [0, 1, 2].map(key => <div className="service-card skeleton-card" key={key} aria-hidden="true"><span className="skeleton" /><span className="skeleton wide" /><span className="skeleton" /></div>)}{current?.services.map(service => { const v = service.versions?.find(version => version.active); return <article className="service-card" key={service.id}><div className="service-icon"><UiIcon name={service.name.toLowerCase().includes("clean") ? "sparkles" : service.name.toLowerCase().includes("security") ? "shield" : "wrench"} /></div><h3>{service.name}</h3>{v ? <><strong className="price">{money(v.monthlyAmountMinor, v.currency)}<small> / {v.billingPeriod.toLowerCase().replace("_", " ")}</small></strong><p className="service-version"><UiIcon name="check" />Approved version {v.version}</p></> : <p>No active version available</p>}</article>; })}</div>{!isLoading && current?.services.length === 0 && <div className="empty-state"><h3>No services yet</h3><p>The registrar needs to configure this community’s services before owners can propose changes.</p></div>}</section>
      <section className="section"><div className="section-heading"><div><h2>Decisions & proposals</h2><p className="muted">Exact terms. Signed ballots. Public evidence.</p></div><div className="actions"><button className="button ghost small" disabled={busy || isLoading || !buildingId} onClick={refreshData}><UiIcon name="refresh" />{isLoading ? "Refreshing…" : "Refresh"}</button></div></div>
        <div className="decision-tabs" aria-label="Filter decisions">{(["ALL", "PENDING", "APPROVED"] as const).map(value => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{value === "ALL" ? "All decisions" : value === "PENDING" ? "Voting open" : "Approved"}</button>)}</div>
        {!wallet.identity && <p className="muted">Connect an enrolled wallet to create proposals and sign votes.</p>}
        {isLoading && <p className="muted" role="status">Loading community data…</p>}
        {!isLoading && current && filteredProposals.length === 0 && <div className="empty-state"><UiIcon name="layers" /><h3>{filter === "ALL" ? "No proposals yet" : filter === "PENDING" ? "No open votes" : "No approved decisions yet"}</h3><p>{filter === "ALL" ? "Your next service decision starts with a proposal." : "Choose another filter to see the community’s decisions."}</p>{filter === "ALL" && canWrite && <button className="button small" disabled={busy || !members.length || !current.services.some(service => service.active)} onClick={openForm}>New proposal</button>}</div>}
        <div className="proposal-list">{filteredProposals.map(p => <article className="proposal-card" key={p.id}><div className="proposal-head"><div><span className={`badge ${p.status.toLowerCase()}`}>{p.status === "PENDING" ? "Voting open" : p.status === "APPROVED" ? "Approved" : p.status === "REJECTED" ? "Rejected" : "Draft"}</span><span className="mode">{p.authorizationMode === "WALLET_SIGNED" ? "Wallet signatures" : "Legacy unsigned demo"}</span><h3>{p.title}</h3></div><button className="button small ghost" disabled={busy} onClick={() => review(p)}>Review <UiIcon name="arrow" /></button></div><p>{p.description ?? "Review the proposed service terms and voting policy."}</p><div className="vote-progress" role="progressbar" aria-label="Approval weight" aria-valuenow={p.tally.approvalWeightBps / 100} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${Math.min(100, p.tally.approvalWeightBps / 100)}%` }} /></div><div className="proposal-foot"><span>{percent(p.tally.approvalWeightBps)} approval / {percent(p.governanceSnapshot.governanceThresholdBps)} required</span><span>{p.tally.voteCount} votes · {percent(p.tally.participationWeightBps)} participation</span></div><div className="proposal-network"><span><UiIcon name="fingerprint" />{p.status === "APPROVED" ? "Approval recorded" : "Decision in progress"}</span><span>{p.status === "APPROVED" ? "Open proof to check Devnet" : "Anchoring follows approval"}</span></div></article>)}</div>
      </section>
      {selected && <section className="review-panel" ref={reviewRef} tabIndex={-1} aria-label="Review proposal"><div className="section-heading"><div><div className="eyebrow">REVIEW BEFORE SIGNING</div><h2>{selected.title}</h2></div><button className="button ghost small" disabled={busy} onClick={closeReview}>Close</button></div><div className="review-grid"><div><h3>Proposed terms · version {selected.proposedVersion.version}</h3><p className="price">{money(selected.proposedVersion.monthlyAmountMinor, selected.proposedVersion.currency)} <small>/ {selected.proposedVersion.billingPeriod.toLowerCase()}</small></p><p>{selected.proposedVersion.description}</p><details><summary>Service configuration</summary><pre>{JSON.stringify(selected.proposedVersion.configJson, null, 2)}</pre></details><dl><dt>Approval threshold</dt><dd>{percent(selected.governanceSnapshot.governanceThresholdBps)}</dd><dt>Quorum</dt><dd>{percent(selected.governanceSnapshot.quorumBps)}</dd><dt>Proposal fingerprint</dt><dd className="hash">{selected.signingHash ?? "Unsigned demo"}</dd></dl></div><div>
        {selected.authorizationMode !== "WALLET_SIGNED" ? <div className="alert">This historical demo has no wallet-signed ballots.</div> : selected.status === "APPROVED" ? <><div className="alert success">The approval threshold and quorum were met.</div><button className="button" disabled={!canWrite || busy} onClick={() => void run(() => createCommitment(selected))}>{busy ? actionPhase || "Preparing evidence…" : "Create / open proof"}</button><p className="muted">The proof can be anchored by the authorized building operator.</p></> : selected.status !== "PENDING" ? <div className="alert">This proposal is closed: {selected.status.toLowerCase()}.</div> : !canWrite ? <div className="alert">Sign in with an eligible wallet for this building to vote.</div> : <>
          <label>Your unit<select value={membershipId} disabled={busy} onChange={e => { setMembershipId(e.target.value); setBallot(null); }}><option value="">Choose an eligible unit</option>{members.map(m => <option key={m.id} value={m.id}>Unit {unitLabel(m.unitId)}</option>)}</select></label>
          {!eligible ? <p className="muted">This membership or wallet is not in the frozen electorate.</p> : hasVoted ? <div className="alert success">Your unit has already voted.</div> : <><label>Vote<select value={choice} disabled={busy} onChange={e => { setChoice(e.target.value as Choice); setBallot(null); }}><option value="APPROVE">Approve</option><option value="REJECT">Reject</option><option value="ABSTAIN">Abstain</option></select></label><p className="muted">Unit voting weight: {percent(eligible.votingWeightBps)}. Your vote cannot be changed after submission.</p>{!ballot ? <button className="button" disabled={busy} onClick={() => void run(prepareBallot)}>{busy ? actionPhase || "Preparing…" : "Review signing message"}</button> : <><div className="alert">You will sign an <strong>{ballot.choice.toLowerCase()}</strong> vote for this proposal. No funds will be transferred.</div><details open><summary>Exact message sent to Phantom</summary><pre>{ballot.message}</pre></details><button className="button" disabled={busy} onClick={() => void run(submitBallot)}>{busy ? actionPhase || "Working…" : `Sign ${ballot.choice.toLowerCase()} & submit`}</button></>}</>}
        </>}
      </div></div></section>}
      {showForm && <section className="review-panel" ref={reviewRef} tabIndex={-1} aria-label="Create proposal"><div className="section-heading"><h2>Propose a service change</h2><button className="button ghost small" disabled={busy} onClick={() => setShowForm(false)}>Cancel</button></div><form onSubmit={event => void createProposal(event)} className="proposal-form"><label>Service<select value={serviceId} onChange={e => chooseService(e.target.value)} required>{current?.services.filter(s => s.active).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label><label>Submitting unit<select value={membershipId} onChange={e => setMembershipId(e.target.value)} required>{members.map(m => <option key={m.id} value={m.id}>Unit {unitLabel(m.unitId)}</option>)}</select></label><label className="full">Proposal / version title<input value={title} onChange={e => setTitle(e.target.value)} required maxLength={160} /></label><label>Amount per billing period<input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" required /></label><label>Currency<select value={currency} onChange={e => setCurrency(e.target.value)}><option>GEL</option><option>USD</option><option>EUR</option></select></label><label>Billing period<select value={period} onChange={e => setPeriod(e.target.value)}><option value="MONTHLY">Monthly</option><option value="WEEKLY">Weekly</option><option value="YEARLY">Yearly</option><option value="ONE_OFF">One-off</option></select></label><label className="full">Description<textarea value={description} onChange={e => setDescription(e.target.value)} maxLength={4000} rows={3} /></label><label className="full">Service configuration (JSON)<textarea className="code-input" value={config} onChange={e => setConfig(e.target.value)} rows={5} /></label><div className="full"><p className="muted">All eligible owners must have enrolled wallets. Creating the proposal freezes terms, policy and eligible wallets; your vote is a separate signature.</p><button className="button" disabled={busy || !canWrite}>{busy ? actionPhase || "Creating…" : "Create signed-voting proposal"}</button></div></form></section>}
      <footer><span><span className="dot" />Solana Devnet · proof fingerprints</span><Link href={`/verify/${FEATURED_BUILDING}/${FEATURED_COMMITMENT}`}>View verified demo <UiIcon name="arrow" /></Link><span>Wallet signatures prove consent. Registrar enrollment asserts ownership.</span></footer>
    </main>
  </div>;
}
