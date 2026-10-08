// Server components call the backend directly; the browser goes through the /api proxy
// (see next.config.mjs) so the whole app is served from one origin.
export const API_URL =
  typeof window === "undefined" ? (process.env.BACKEND_URL ?? "http://localhost:8000") : "/api";

export type HealthStatus = { status: string; database?: string };

export async function fetchHealth(path: "/health" | "/health/db"): Promise<HealthStatus | null> {
  try {
    const res = await fetch(`${API_URL}${path}`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as HealthStatus;
  } catch {
    return null;
  }
}
