"use client";

import { useMemo, useState } from "react";

import { Alert, Button, Card, Input, Table, Td } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import type { Exam, User } from "@/lib/types";
import { useApi } from "@/lib/useApi";

export function CandidatesTab({ exam }: { exam: Exam }) {
  const enrolled = useApi<User[]>(`/exams/${exam.id}/candidates`);
  const all = useApi<User[]>("/users?role=candidate");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canEnroll = exam.status !== "closed";
  const canRemove = exam.status === "draft" || exam.status === "sealed";
  const enrolledIds = useMemo(() => new Set((enrolled.data ?? []).map((u) => u.id)), [enrolled.data]);
  const available = (all.data ?? []).filter(
    (u) =>
      u.is_active &&
      !enrolledIds.has(u.id) &&
      `${u.full_name} ${u.email}`.toLowerCase().includes(query.toLowerCase()),
  );

  function toggle(id: number) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  async function enroll() {
    setBusy(true);
    setError(null);
    try {
      enrolled.setData(
        await api<User[]>(`/exams/${exam.id}/candidates`, { json: { candidate_ids: Array.from(selected) } }),
      );
      setSelected(new Set());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    try {
      await api(`/exams/${exam.id}/candidates/${id}`, { method: "DELETE" });
      void enrolled.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-slate-400">
          Enrolled ({enrolled.data?.length ?? 0})
        </h2>
        <Table head={["Candidate", ""]} empty="No candidates enrolled yet.">
          {(enrolled.data ?? []).map((u) => (
            <tr key={u.id}>
              <Td>
                {u.full_name}
                <div className="text-xs text-slate-500">{u.email}</div>
              </Td>
              <Td className="text-right">
                {canRemove && (
                  <Button variant="ghost" onClick={() => remove(u.id)}>
                    Remove
                  </Button>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      </div>
      {canEnroll && (
        <Card className="h-fit">
          <h2 className="mb-3 font-medium text-white">Enrol candidates</h2>
          <Input placeholder="Search by name or email" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="mt-3 max-h-80 space-y-1 overflow-y-auto">
            {available.length === 0 && (
              <p className="py-4 text-sm text-slate-500">
                No other active candidates. Create candidate accounts on the Users page.
              </p>
            )}
            {available.map((u) => (
              <label key={u.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-white/5">
                <input type="checkbox" checked={selected.has(u.id)} onChange={() => toggle(u.id)} className="accent-cyan-400" />
                <span className="text-sm">
                  {u.full_name} <span className="text-slate-500">· {u.email}</span>
                </span>
              </label>
            ))}
          </div>
          {available.length > 0 && (
            <button
              className="mt-2 text-xs text-cyan-300 hover:underline"
              onClick={() => setSelected(new Set(available.map((u) => u.id)))}
            >
              Select all shown
            </button>
          )}
          {error && (
            <div className="mt-3">
              <Alert>{error}</Alert>
            </div>
          )}
          <Button className="mt-4 w-full" onClick={enroll} busy={busy} disabled={selected.size === 0}>
            Enrol {selected.size || ""} selected
          </Button>
        </Card>
      )}
    </div>
  );
}
