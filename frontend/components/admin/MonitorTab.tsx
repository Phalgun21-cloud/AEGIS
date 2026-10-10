"use client";

import { useEffect, useRef, useState } from "react";

import { Alert, Badge, Stat, Table, Td } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { fmtTime } from "@/lib/format";
import type { Exam, MonitorSnapshot } from "@/lib/types";

type Transport = "connecting" | "websocket" | "polling";

const POLL_MS = 3000;

export function MonitorTab({ exam, onStatus }: { exam: Exam; onStatus: () => void }) {
  const [snap, setSnap] = useState<MonitorSnapshot | null>(null);
  const [transport, setTransport] = useState<Transport>("connecting");
  const [error, setError] = useState<string | null>(null);
  const lastStatus = useRef(exam.status);
  // Held in a ref so a new callback from the parent doesn't reopen the socket.
  const onStatusRef = useRef(onStatus);
  useEffect(() => {
    onStatusRef.current = onStatus;
  }, [onStatus]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    let ws: WebSocket | null = null;
    let gotMessage = false;

    const accept = (s: MonitorSnapshot) => {
      if (cancelled) return;
      setSnap(s);
      setError(null);
      if (s.status !== lastStatus.current) {
        lastStatus.current = s.status;
        onStatusRef.current();
      }
    };

    const startPolling = () => {
      if (cancelled || timer) return;
      setTransport("polling");
      const poll = () =>
        api<MonitorSnapshot>(`/exams/${exam.id}/monitor`)
          .then(accept)
          .catch((e) => !cancelled && setError(errorMessage(e)));
      void poll();
      timer = setInterval(poll, POLL_MS);
    };

    // Same-origin WebSocket through the /api proxy, authenticated by the session cookie;
    // fall back to polling if it can't connect.
    try {
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${window.location.host}/api/ws/exams/${exam.id}/monitor`);
      ws.onmessage = (ev) => {
        gotMessage = true;
        setTransport("websocket");
        accept(JSON.parse(ev.data) as MonitorSnapshot);
      };
      ws.onerror = () => startPolling();
      ws.onclose = () => startPolling();
      // If nothing arrives quickly, don't leave the admin staring at a blank screen.
      setTimeout(() => !gotMessage && startPolling(), 4000);
    } catch {
      startPolling();
    }

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      if (ws) {
        ws.onclose = null;
        ws.onerror = null;
        ws.close();
      }
    };
  }, [exam.id]);

  if (error && !snap) return <Alert>{error}</Alert>;
  if (!snap) return <p className="text-sm text-slate-400">Connecting to live monitor…</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 text-sm text-slate-400">
        <span className={`h-2 w-2 rounded-full ${transport === "websocket" ? "animate-pulse bg-emerald-400" : "bg-amber-400"}`} />
        {transport === "websocket" ? "Live updates over WebSocket" : `Refreshing every ${POLL_MS / 1000}s`}
        <span>· server time {fmtTime(snap.server_time)}</span>
        <Badge value={snap.status} />
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <Stat label="Enrolled" value={snap.enrolled} />
        <Stat label="Not started" value={snap.not_started} />
        <Stat label="In progress" value={snap.in_progress} />
        <Stat label="Submitted" value={snap.submitted} />
        <Stat label="Questions" value={snap.questions} />
      </div>
      <Table head={["Candidate", "Started", "Last saved", "Answered", "Submitted"]} empty="No one has started yet.">
        {snap.attempts.map((a) => (
          <tr key={a.attempt_id}>
            <Td>{a.candidate_name}</Td>
            <Td>{fmtTime(a.started_at)}</Td>
            <Td>{fmtTime(a.last_saved_at)}</Td>
            <Td className="tabular-nums">
              {a.answered} / {snap.questions}
            </Td>
            <Td>
              {a.submitted_at ? (
                <span className={a.auto_submitted ? "text-amber-300" : "text-emerald-300"}>
                  {fmtTime(a.submitted_at)}
                  {a.auto_submitted && " (time up)"}
                </span>
              ) : (
                <span className="text-cyan-300">In progress</span>
              )}
            </Td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
