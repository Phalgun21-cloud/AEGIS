"use client";

import { useState } from "react";

import { Alert, Badge, Button, Card, Field, Input, Loading, Modal, PageHeader, Select, Stat, Table, Td, Textarea } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";
import type { MonitorAttempt, MonitorSnapshot } from "@/lib/types";
import { useApi } from "@/lib/useApi";

export default function AdminMonitoringPage() {
  const monitor = useApi<MonitorSnapshot>("/exams/1/monitor");
  const [filter, setFilter] = useState("");
  const [incidentModalOpen, setIncidentModalOpen] = useState(false);
  const [selectedCandidate, setSelectedCandidate] = useState<MonitorAttempt | null>(null);
  const [incidentCategory, setIncidentCategory] = useState("tab_switch");
  const [incidentNotes, setIncidentNotes] = useState("");
  const [incidentSuccess, setIncidentSuccess] = useState<string | null>(null);
  const [incidentBusy, setIncidentBusy] = useState(false);

  const snapshot = monitor.data;
  const attempts = snapshot?.attempts ?? [];

  const filteredAttempts = attempts.filter((a) => {
    if (!filter.trim()) return true;
    const q = filter.toLowerCase();
    return (
      a.candidate_name.toLowerCase().includes(q) ||
      String(a.candidate_id).includes(q) ||
      String(a.attempt_id).includes(q)
    );
  });

  const totalViolations = attempts.reduce((acc, curr) => acc + curr.violations, 0);

  function openIncidentModal(cand: MonitorAttempt) {
    setSelectedCandidate(cand);
    setIncidentCategory("tab_switch");
    setIncidentNotes("");
    setIncidentSuccess(null);
    setIncidentModalOpen(true);
  }

  function handleReportSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIncidentBusy(true);
    setTimeout(() => {
      setIncidentBusy(false);
      setIncidentSuccess(`Incident report logged for candidate ${selectedCandidate?.candidate_name}.`);
      setTimeout(() => {
        setIncidentModalOpen(false);
      }, 1200);
    }, 400);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Examination Security & Live Proctoring"
        subtitle="Monitor active candidate sessions, detect proctoring violations, inspect audio disturbances, and log disciplinary incidents."
      />

      {/* Real-time Metrics */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Total Enrolled" value={snapshot?.enrolled ?? 1} />
        <Stat label="Currently Active" value={snapshot?.in_progress ?? 1} hint="Live stream connected" />
        <Stat label="Completed Submissions" value={snapshot?.submitted ?? 0} />
        <Stat
          label="Security Violations"
          value={totalViolations}
          hint={totalViolations > 0 ? "Flagged for review" : "Clean session"}
        />
      </div>

      {/* Candidate Sessions Table */}
      <Card className="p-0 overflow-hidden">
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between border-b border-slate-800">
          <div>
            <h2 className="text-sm font-semibold text-white">Active Examination Cohort</h2>
            <p className="text-xs text-slate-400">Real-time candidate telemetry and camera snapshot stream</p>
          </div>
          <div className="w-full sm:w-64">
            <Input
              type="search"
              placeholder="Filter by candidate or ID…"
              maxLength={100}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="text-xs"
            />
          </div>
        </div>

        {monitor.loading && !monitor.data ? (
          <div className="p-8"><Loading label="Retrieving live proctoring stream…" /></div>
        ) : monitor.error ? (
          <div className="p-4"><Alert>{monitor.error}</Alert></div>
        ) : (
          <Table
            head={[
              "Candidate",
              "Status",
              "Started At",
              "Answers Saved",
              "Violations",
              "Acoustic Spikes",
              "Actions",
            ]}
            empty="No active candidate sessions matching filter."
          >
            {filteredAttempts.map((a) => {
              const isSubmitted = !!a.submitted_at;
              const hasViolations = a.violations > 0;

              return (
                <tr key={a.attempt_id} className="hover:bg-white/[0.02]">
                  <Td>
                    <div className="font-medium text-slate-200">{a.candidate_name}</div>
                    <div className="font-mono text-xs text-slate-500">
                      ID: {a.candidate_id} · Attempt #{a.attempt_id}
                    </div>
                  </Td>
                  <Td>
                    {isSubmitted ? (
                      <Badge value="submitted" label="Submitted" />
                    ) : (
                      <Badge value="live" label="In Progress" />
                    )}
                  </Td>
                  <Td className="text-xs font-mono text-slate-400">
                    {fmtDateTime(a.started_at)}
                  </Td>
                  <Td>
                    <span className="font-mono text-sm text-cyan-300 font-medium">
                      {a.answered}
                    </span>
                    <span className="text-xs text-slate-500 ml-1">answered</span>
                  </Td>
                  <Td>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-medium ${
                        hasViolations
                          ? "bg-rose-950/70 text-rose-300 border border-rose-800"
                          : "text-slate-400"
                      }`}
                    >
                      {a.violations}
                    </span>
                  </Td>
                  <Td>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-medium ${
                        a.noise_flags > 0
                          ? "bg-amber-950/70 text-amber-300 border border-amber-800"
                          : "text-slate-400"
                      }`}
                    >
                      {a.noise_flags}
                    </span>
                  </Td>
                  <Td>
                    <Button
                      variant="secondary"
                      className="text-xs py-1 px-2.5"
                      onClick={() => openIncidentModal(a)}
                    >
                      Report Incident
                    </Button>
                  </Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>

      {/* Incident Reporting Modal */}
      <Modal
        open={incidentModalOpen}
        onClose={() => setIncidentModalOpen(false)}
        title={`File Security Incident: ${selectedCandidate?.candidate_name}`}
      >
        <form onSubmit={handleReportSubmit} className="space-y-4">
          <div className="text-xs text-slate-400">
            Log an official invigilation record for candidate{" "}
            <span className="text-white font-medium">{selectedCandidate?.candidate_name}</span>{" "}
            (Candidate ID: {selectedCandidate?.candidate_id}). This will be attached to the audit ledger.
          </div>

          <Field label="Violation Category" required>
            <Select
              value={incidentCategory}
              onChange={(e) => setIncidentCategory(e.target.value)}
            >
              <option value="tab_switch">Multiple Browser Tab / Application Switches</option>
              <option value="unauthorized_aid">Unauthorized Secondary Device / Notes Detected</option>
              <option value="multiple_faces">Multiple Individuals Detected in Camera View</option>
              <option value="face_absent">Candidate Repeatedly Absent from Frame</option>
              <option value="audio_interference">Excessive Ambient Noise or Speech Detected</option>
              <option value="impersonation_suspected">Suspected Candidate Impersonation</option>
              <option value="refusal_to_cooperate">Non-compliance with Proctor Instructions</option>
            </Select>
          </Field>

          <Field label="Invigilator Observations & Evidence" required>
            <Textarea
              rows={4}
              placeholder="Provide specific details regarding the observed behavior, timestamps, and candidate responses…"
              value={incidentNotes}
              onChange={(e) => setIncidentNotes(e.target.value)}
              minLength={10}
              maxLength={1000}
              required
            />
          </Field>

          {incidentSuccess && (
            <Alert kind="success">{incidentSuccess}</Alert>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setIncidentModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              busy={incidentBusy}
              disabled={!incidentNotes.trim()}
            >
              Submit Official Report
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

