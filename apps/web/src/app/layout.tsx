import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
const nunito = localFont({ src: "./fonts/NunitoVariable.ttf", variable: "--font-nunito", display: "swap", weight: "200 1000" });
export const metadata: Metadata = {
  title: "CondoProof — Verifiable Building Governance",
  description: "Review service terms, sign your vote and independently verify shared-building decisions on Solana Devnet.",
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en" className={nunito.variable}><body>{children}</body></html>;
}
