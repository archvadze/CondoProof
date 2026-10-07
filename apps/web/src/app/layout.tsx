import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "CondoProof — Verifiable Building Governance",
  description: "Review service terms, sign your vote and independently verify shared-building decisions on Solana Devnet.",
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
