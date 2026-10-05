# CondoProof

Verifiable Governance Infrastructure for Shared Buildings.

## MVP

Building -> Service Proposal -> Resident Approval / Voting -> Approved Version -> On-chain Commitment -> Verification

## Architecture

PostgreSQL is the operational source of truth.
Next.js provides the web application.
NestJS provides the API and application layer.
Solana is used only for verifiable trust-critical state.
The custom Anchor program stores commitments and identifiers, not PII, invoices, documents, or sensitive business data.

## Structure

- apps/web - Next.js frontend
- apps/api - NestJS backend
- packages/shared - shared TypeScript contracts
- programs/condoproof - Anchor/Rust Solana program
- docs - architecture and hackathon documentation
