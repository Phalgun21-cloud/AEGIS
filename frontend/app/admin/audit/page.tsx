"use client";

import { useCallback, useEffect, useState } from "react";

import { Alert, Button, Input, PageHeader, Table, Td } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { fmtDateTime, shortHash } from "@/lib/format";
import type { AuditEntry, ChainReport } from "@/lib/types";

const PAGE = 50;

export default function AuditPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [action, setAction] = useState("");
  const [applied, setApplied] = useState("");
  const [more, setMore] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ChainReport | null>(null);
  const [verifying, setVerifying] = useState(false);

  const load = useCallback(
    async (beforeId?: number) => {
      setBusy(true);
      try {
        const qs = new URLSearchParams({ limit: String(PAGE) });
        if (applied) qs.set("action", applied);
        if (beforeId) qs.set("before_id", String(beforeId));
        const page = await api<AuditEntry[]>(`/audit?${qs}`);
        setEntries((prev) => (beforeId ? [...prev, ...page] : page));
        setMore(page.length === PAGE);
        setError(null);
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setBusy(false);
      }
    },
    [applied],
  );

  useEffect(() => {
    void load();
  }, [load]);

  async function verify() {
    setVerifying(true);
    try {
      setReport(await api<ChainReport>("/audit/verify"));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setVerifying(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Audit Logs"
        subtitle="Append-only. Each entry's hash covers the previous entry's hash."
        actions={
          <Button variant="secondary" onClick={verify} busy={verifying}>
            Verify chain
          </Button>
        }
      />
      {report && (
        <div className="mb-4">
          {report.valid ? (
            <Alert kind="success">
              Chain intact: {report.entries} entries verified. Head hash{" "}
              <code className="font-mono">{shortHash(report.head_hash, 16)}</code>
            </Alert>
          ) : (
            <Alert>
              Chain broken at entry #{report.first_broken_id}. A log entry was altered or removed.
            </Alert>
          )}
        </div>
      )}
      <form
        className="mb-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied(action.trim());
        }}
      >
        <Input
          className="max-w-xs"
          placeholder="Filter by action, e.g. paper.released"
          value={action}
          onChange={(e) => setAction(e.target.value)}
        />
        <Button type="submit" variant="secondary">
          Filter
        </Button>
      </form>
      {error && <Alert>{error}</Alert>}
      <Table head={["#", "Time", "Action", "Actor", "Entity", "Details", "Hash"]} empty={busy ? "Loading…" : "No entries."}>
        {entries.map((e) => (
          <tr key={e.id}>
            <Td className="tabular-nums text-slate-500">{e.id}</Td>
            <Td className="whitespace-nowrap">{fmtDateTime(e.created_at)}</Td>
            <Td>
              <code className="font-mono text-cyan-200">{e.action}</code>
            </Td>
            <Td>{e.actor_name ?? <span className="text-slate-500">system</span>}</Td>
            <Td className="whitespace-nowrap">{e.entity_type ? `${e.entity_type} ${e.entity_id ?? ""}` : "—"}</Td>
            <Td className="max-w-xs break-words font-mono text-xs text-slate-400">
              {e.details ? JSON.stringify(e.details) : "—"}
            </Td>
            <Td className="font-mono text-xs text-slate-500" >
              <span title={e.entry_hash}>{shortHash(e.entry_hash, 10)}</span>
            </Td>
          </tr>
        ))}
      </Table>
      {more && entries.length > 0 && (
        <div className="mt-4 text-center">
          <Button variant="ghost" busy={busy} onClick={() => load(entries[entries.length - 1].id)}>
            Load older entries
          </Button>
        </div>
      )}
    </>
  );
}
