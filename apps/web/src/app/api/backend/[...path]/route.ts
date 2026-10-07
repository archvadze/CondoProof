import "server-only";
import { cookies } from "next/headers";
import { handleBackend, SESSION_COOKIE } from "@/lib/backend-proxy";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handle(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return handleBackend(request, path, token);
}
export { handle as GET, handle as POST };
