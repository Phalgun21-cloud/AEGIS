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

// ---------- authenticated client (browser only) ----------

// The session lives in an httpOnly cookie set by the API, so page scripts never see the token.
// Every request carries this header; the API refuses cookie-authenticated writes without it,
// which a cross-site page can't forge (CSRF protection).
const CSRF_HEADERS = { "X-AEGIS-CSRF": "1" };

// True while signed in, so an expired session (401) can send the user back to the login page.
let sessionActive = false;

export function setSessionActive(active: boolean) {
  sessionActive = active;
}

// Before Phase 5 the token was kept in sessionStorage; remove any copy left behind.
if (typeof window !== "undefined") {
  try {
    sessionStorage.removeItem("aegis.token");
  } catch {
    /* storage unavailable */
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public detail: unknown,
  ) {
    super(formatDetail(detail) || `Request failed (${status})`);
  }
}

function formatDetail(detail: unknown): string {
  if (!detail) return "";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((d) => {
        const loc = Array.isArray(d?.loc) ? d.loc.filter((x: unknown) => x !== "body").join(".") : "";
        return loc ? `${loc}: ${d?.msg}` : String(d?.msg ?? d);
      })
      .join("; ");
  }
  if (typeof detail === "object" && "message" in detail) {
    return String((detail as { message: unknown }).message);
  }
  return JSON.stringify(detail);
}

const OFFLINE =
  "Can't reach the AEGIS server. Make sure it's running (double-click start-aegis.cmd or run `npm run dev` in the project folder), then try again.";

type Options = {
  method?: string;
  json?: unknown;
  form?: FormData | URLSearchParams;
  blob?: Blob; // sent as-is with its own type (e.g. a webcam JPEG)
};

export async function api<T>(path: string, opts: Options = {}): Promise<T> {
  const headers: Record<string, string> = { ...CSRF_HEADERS };
  let body: BodyInit | undefined;
  if (opts.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.json);
  } else if (opts.form) {
    body = opts.form;
  } else if (opts.blob) {
    headers["Content-Type"] = opts.blob.type || "application/octet-stream";
    body = opts.blob;
  }
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: opts.method ?? (body ? "POST" : "GET"),
      headers,
      body,
      cache: "no-store",
      credentials: "same-origin",
    });
  } catch {
    // The web server itself is down (the browser couldn't connect at all).
    throw new ApiError(0, OFFLINE);
  }
  if (res.status === 401 && sessionActive) {
    sessionActive = false;
    window.dispatchEvent(new Event("aegis:logout"));
  }
  if (!res.ok) {
    let detail: unknown = null;
    try {
      detail = (await res.json()).detail;
    } catch {
      /* non-JSON error */
    }
    // A bare 5xx with no API error body comes from the /api proxy: the backend is down.
    if (detail === null && res.status >= 500) detail = OFFLINE;
    throw new ApiError(res.status, detail);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Fetches an authenticated binary (e.g. a question image) as an object URL. */
export async function apiBlobUrl(path: string): Promise<string | null> {
  const res = await fetch(`/api${path}`, {
    headers: CSRF_HEADERS,
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!res.ok) return null;
  return URL.createObjectURL(await res.blob());
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
