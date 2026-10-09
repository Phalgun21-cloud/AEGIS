"use client";

import { useState } from "react";

import { Alert, Badge, Button, Card, Table, Td } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { fmtDateTime, shortHash } from "@/lib/format";
import type { AnchorVerification, AnchorsOverview } from "@/lib/types";
import { useApi } from "@/lib/useApi";

const NETWORKS: Record<number, string> = { 31337: "Local Hardhat", 11155111: "Sepolia testnet" };
const CHECK_LABELS: Record<string, string> = {
  onchain_matches_record: "On-chain record matches",
  entry_present_and_unchanged: "Anchored entry unchanged",
  chain_valid_up_to_anchor: "Chain intact up to anchor",
};

export function AnchorsPanel() {
  const overview = useApi<AnchorsOverview>("/audit/anchors");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "error" | "success" | "info"; text: string } | null>(null);
  const [results, setResults] = useState<Record<number, AnchorVerification | "checking">>({});

  const o = overview.data;
  if (!o) return overview.error ? <Alert>{overview.error}</Alert> : null;

  async function anchorNow() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ anchored: boolean; detail?: string }>("/audit/anchors", { method: "POST" });
      setMsg(r.anchored ? { kind: "success", text: "Audit chain head anchored on-chain." } : { kind: "info", text: r.detail ?? "Nothing new to anchor." });
      void overview.reload();
    } catch (e) {
      setMsg({ kind: "error", text: errorMessage(e) });
      void overview.reload();
    } finally {
      setBusy(false);
    }
  }

  async function verify(id: number) {
    setResults((r) => ({ ...r, [id]: "checking" }));
    try {
      const v = await api<AnchorVerification>(`/audit/anchors/${id}/verify`);
      setResults((r) => ({ ...r, [id]: v }));
    } catch (e) {
      setResults((r) => ({ ...r, [id]: { valid: false, reason: errorMessage(e) } }));
    }
  }

  const behind = o.head_audit_id !== null && (o.last_anchored_audit_id ?? 0) < o.head_audit_id;

  return (
    <Card className="mb-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-medium text-white">Blockchain anchors</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            The newest audit hash is written to the AuditAnchor contract. Because every entry&apos;s hash covers the one
            before it, each anchor fixes all earlier entries. Only hashes go on-chain, never exam content.
          </p>
        </div>
        {o.enabled && (
          <Button variant="secondary" onClick={anchorNow} busy={busy} disabled={!behind}>
            {behind ? "Anchor now" : "Up to date"}
          </Button>
        )}
      </div>

      {!o.enabled ? (
        <div className="mt-4">
          <Alert kind="info">
            Anchoring is off. It&apos;s optional: set ANCHOR_ENABLED and the ANCHOR_* settings in backend/.env (see
            README, Phase 4) to anchor to a local Hardhat chain or the Sepolia testnet.
          </Alert>
        </div>
      ) : (
        <>
          <dl className="mt-4 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-slate-500">Network</dt>
              <dd>{NETWORKS[o.chain_id ?? 0] ?? `Chain ${o.chain_id}`}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Contract</dt>
              <dd className="font-mono text-xs" title={o.contract_address ?? ""}>
                {shortHash(o.contract_address, 14)}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Coverage</dt>
              <dd>
                {o.last_anchored_audit_id ? `entries 1–${o.last_anchored_audit_id}` : "nothing anchored yet"} of{" "}
                {o.head_audit_id ?? 0}
              </dd>
            </div>
          </dl>
          {msg && (
            <div className="mt-4">
              <Alert kind={msg.kind}>{msg.text}</Alert>
            </div>
          )}
          <div className="mt-4">
            <Table head={["#", "Covers up to", "Status", "Block / tx", "Anchored", ""]} empty="No anchors yet. They are created automatically after critical events.">
              {o.anchors.map((a) => {
                const r = results[a.id];
                return (
                  <tr key={a.id}>
                    <Td className="text-slate-500">{a.id}</Td>
                    <Td>
                      entry #{a.audit_log_id}
                      <div className="font-mono text-xs text-slate-500" title={a.entry_hash}>
                        {shortHash(a.entry_hash, 12)}
                      </div>
                    </Td>
                    <Td>
                      <Badge
                        value={a.status === "confirmed" ? "approved" : a.status === "failed" ? "rejected" : "submitted"}
                        label={a.status}
                      />
                      {a.error && <div className="mt-1 max-w-xs text-xs text-rose-300">{a.error}</div>}
                    </Td>
                    <Td className="font-mono text-xs">
                      {a.block_number ?? "—"}
                      <div className="text-slate-500" title={a.tx_hash ?? ""}>
                        {shortHash(a.tx_hash, 12)}
                      </div>
                    </Td>
                    <Td className="whitespace-nowrap">{fmtDateTime(a.confirmed_at ?? a.created_at)}</Td>
                    <Td className="min-w-48">
                      {a.status === "confirmed" &&
                        (r === undefined ? (
                          <Button variant="ghost" onClick={() => verify(a.id)}>
                            Verify against chain
                          </Button>
                        ) : r === "checking" ? (
                          <span className="text-sm text-slate-400">Checking…</span>
                        ) : r.valid ? (
                          <span className="text-sm text-emerald-300">✓ Matches blockchain ({r.entries_covered} entries)</span>
                        ) : (
                          <div className="text-sm text-rose-300">
                            ✗ Mismatch
                            {r.reason && <div className="text-xs">{r.reason}</div>}
                            {r.checks &&
                              Object.entries(r.checks)
                                .filter(([, ok]) => !ok)
                                .map(([k]) => (
                                  <div key={k} className="text-xs">
                                    Failed: {CHECK_LABELS[k] ?? k}
                                  </div>
                                ))}
                          </div>
                        ))}
                    </Td>
                  </tr>
                );
              })}
            </Table>
          </div>
        </>
      )}
    </Card>
  );
}
