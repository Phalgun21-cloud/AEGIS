import {
  DEMO_ATTEMPT,
  DEMO_AUDIT_LOGS,
  DEMO_EXAMS,
  DEMO_MONITOR_SNAPSHOT,
  DEMO_QUESTIONS_PAPER,
  DEMO_REVIEW_QUEUE,
} from "./demoData";
import type {
  Attempt,
  CandidateExam,
  MonitorSnapshot,
  Overview,
  Question,
  Receipt,
  SaveAck,
  User,
} from "./types";

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

const CSRF_HEADERS = { "X-AEGIS-CSRF": "1" };

let sessionActive = false;

export function setSessionActive(active: boolean) {
  sessionActive = active;
}

export function isDemoSession(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(sessionStorage.getItem("aegis_demo_user"));
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
  blob?: Blob;
};

// In-memory demo state for interactive mutations during demo mode
const demoState = {
  answers: { ...DEMO_ATTEMPT.answers } as Record<string, unknown>,
  submitted: false,
  questionsQueue: [...DEMO_REVIEW_QUEUE],
  exams: [...DEMO_EXAMS],
};

/**
 * Handles mocked responses when operating in frontend Demo Mode
 */
function handleDemoApi<T>(path: string, opts: Options = {}): T | null {
  const method = (opts.method ?? (opts.json || opts.form ? "POST" : "GET")).toUpperCase();

  // /candidate/exams
  if (path === "/candidate/exams") {
    return demoState.exams as unknown as T;
  }

  // /candidate/exams/:id/start
  if (path.match(/^\/candidate\/exams\/\d+\/start$/)) {
    const attempt: Attempt = {
      ...DEMO_ATTEMPT,
      answers: { ...demoState.answers } as Record<string, number>,
      submitted_at: demoState.submitted ? new Date().toISOString() : null,
    };
    return attempt as unknown as T;
  }

  // /candidate/attempts/:id/answers
  if (path.match(/^\/candidate\/attempts\/\d+\/answers$/) && method === "PUT") {
    const payload = opts.json as { answers: Record<string, unknown> };
    if (payload?.answers) {
      demoState.answers = { ...demoState.answers, ...payload.answers };
    }
    const ack: SaveAck = {
      saved_at: new Date().toISOString(),
      answered: Object.keys(demoState.answers).length,
      remaining_seconds: 35 * 60,
    };
    return ack as unknown as T;
  }

  // /candidate/attempts/:id/submit
  if (path.match(/^\/candidate\/attempts\/\d+\/submit$/)) {
    demoState.submitted = true;
    const receipt: Receipt = {
      attempt_id: 9001,
      submitted_at: new Date().toISOString(),
      auto_submitted: false,
      answers_sha256: "8f4e2b17a639014cd78932efba0154cc9281734a6bcdef1289456721ea02319f",
      violations: 0,
      max_violations: 3,
    };
    return receipt as unknown as T;
  }

  // /candidate/attempts/:id
  if (path.match(/^\/candidate\/attempts\/\d+$/)) {
    const attempt: Attempt = {
      ...DEMO_ATTEMPT,
      answers: { ...demoState.answers } as Record<string, number>,
      submitted_at: demoState.submitted ? new Date().toISOString() : null,
    };
    return attempt as unknown as T;
  }

  // /reviews/queue
  if (path === "/reviews/queue") {
    return demoState.questionsQueue as unknown as T;
  }

  // /reviews/:id/approve or reject
  if (path.match(/^\/reviews\/\d+\/(approve|reject)$/)) {
    const id = Number(path.split("/")[2]);
    demoState.questionsQueue = demoState.questionsQueue.filter((q) => q.id !== id);
    return { ok: true } as unknown as T;
  }

  // /reviews/:id/similar
  if (path.match(/^\/reviews\/\d+\/similar$/)) {
    return [] as unknown as T;
  }

  // /audit
  if (path.startsWith("/audit")) {
    return DEMO_AUDIT_LOGS as unknown as T;
  }

  // /exams/stats/overview
  if (path === "/exams/stats/overview") {
    const overview: Overview = {
      users: { admin: 3, author: 5, reviewer: 4, candidate: 120 },
      questions: { approved: 86, submitted: 8, draft: 14, rejected: 3 },
      exams: { live: 1, sealed: 2, closed: 5, draft: 1 },
      approved_questions: 86,
    };
    return overview as unknown as T;
  }

  // /exams/:id/monitor
  if (path.match(/^\/exams\/\d+\/monitor$/) || path.includes("/monitor")) {
    return DEMO_MONITOR_SNAPSHOT as unknown as T;
  }

  // /bank/summary
  if (path === "/bank/summary") {
    return [
      { subject: "Cybersecurity", topic: "Vault Protocols", difficulty: "easy", count: 12 },
      { subject: "Cybersecurity", topic: "Vault Protocols", difficulty: "medium", count: 18 },
      { subject: "Cybersecurity", topic: "Vault Protocols", difficulty: "hard", count: 8 },
      { subject: "Computer Science", topic: "Algorithms", difficulty: "medium", count: 24 },
    ] as unknown as T;
  }

  return null;
}

export async function api<T>(path: string, opts: Options = {}): Promise<T> {
  // If in demo mode, serve from demo store when matching mock endpoint
  if (isDemoSession()) {
    const mock = handleDemoApi<T>(path, opts);
    if (mock !== null) {
      // Simulate light async tick
      await new Promise((r) => setTimeout(r, 60));
      return mock;
    }
  }

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
    // If backend is down and we have a mock fallback, use it
    const mock = handleDemoApi<T>(path, opts);
    if (mock !== null) return mock;
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
    if (detail === null && res.status >= 500) {
      const mock = handleDemoApi<T>(path, opts);
      if (mock !== null) return mock;
      detail = OFFLINE;
    }
    throw new ApiError(res.status, detail);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Fetches an authenticated binary (e.g. a question image) as an object URL. */
export async function apiBlobUrl(path: string): Promise<string | null> {
  try {
    const res = await fetch(`/api${path}`, {
      headers: CSRF_HEADERS,
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!res.ok) return null;
    return URL.createObjectURL(await res.blob());
  } catch {
    return null;
  }
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
