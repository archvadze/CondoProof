export class ApiError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/backend${path}`, {
    method: body === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000),
  });
  const data: unknown = await response.json();
  if (!response.ok) {
    const value = data as { message?: unknown };
    const message = Array.isArray(value.message) ? value.message.join("; ") : typeof value.message === "string" ? value.message : "Request failed";
    throw new ApiError(message, response.status);
  }
  return data as T;
}
export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Request failed. Please retry.";
}
