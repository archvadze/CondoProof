import { notFound } from "next/navigation";
import { UUID } from "@/lib/contracts";
import ProofView from "@/components/proof-view";
export default async function VerifyPage({ params }: { params: Promise<{ buildingId: string; commitmentId: string }> }) {
  const { buildingId, commitmentId } = await params;
  if (!UUID.test(buildingId) || !UUID.test(commitmentId)) notFound();
  return <ProofView buildingId={buildingId} commitmentId={commitmentId} />;
}
