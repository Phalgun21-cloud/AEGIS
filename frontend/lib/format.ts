// The API stores and returns naive UTC timestamps (no "Z"); treat them as UTC.
export function parseUtc(s: string): Date {
  return new Date(/[zZ]|[+-]\d\d:\d\d$/.test(s) ? s : `${s}Z`);
}

export function fmtDateTime(s: string | null | undefined): string {
  if (!s) return "—";
  return parseUtc(s).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function fmtTime(s: string | null | undefined): string {
  if (!s) return "—";
  return parseUtc(s).toLocaleTimeString(undefined, { timeStyle: "medium" });
}

export function fmtDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

/** Value for <input type="datetime-local"> in the viewer's local time. */
export function toLocalInput(d: Date): string {
  const off = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}

/** <input type="datetime-local"> value (local time) -> ISO string with timezone. */
export function fromLocalInput(v: string): string {
  return new Date(v).toISOString();
}

export function shortHash(h: string | null | undefined, n = 12): string {
  return h ? `${h.slice(0, n)}…` : "—";
}
