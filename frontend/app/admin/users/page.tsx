"use client";

import { useState } from "react";

import { Alert, Badge, Button, Card, Field, Input, PageHeader, PasswordInput, Select, Table, Td, ValidatedInput } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Role, User } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { validateField } from "@/lib/validation";

const ROLES: { id: Role; label: string }[] = [
  { id: "admin", label: "Administrator (All Governance & Proctoring)" },
  { id: "author", label: "Author (Subject Expert & 100-Mark Allocation)" },
  { id: "reviewer", label: "Reviewer (Paper Verification & Quality QA)" },
  { id: "candidate", label: "Candidate (Student Assessment)" },
];

const EMPTY = { email: "", full_name: "", password: "", role: "candidate" as Role };

export default function UsersPage() {
  const { user: me } = useAuth();
  const [filter, setFilter] = useState<Role | "">("");
  const users = useApi<User[]>(`/users${filter ? `?role=${filter}` : ""}`);
  const [form, setForm] = useState(EMPTY);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  // Email OTP verification state
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [otpVerified, setOtpVerified] = useState(false);
  const [verificationToken, setVerificationToken] = useState<string | null>(null);
  const [otpBusy, setOtpBusy] = useState(false);
  const [otpMsg, setOtpMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [devOtp, setDevOtp] = useState<string | null>(null);

  const rawUsers = users.data ?? [];
  const displayUsers = rawUsers;
  const filteredUsers = filter ? displayUsers.filter((u) => u.role === filter) : displayUsers;

  async function handleSendOtp() {
    const emailVal = validateField("email", form.email, true);
    if (!emailVal.isValid) {
      setFieldErrors((prev) => ({ ...prev, email: emailVal.error! }));
      return;
    }
    setOtpBusy(true);
    setOtpMsg(null);
    try {
      const res = await api<{ ok: boolean; message: string; dev_otp?: string }>("/auth/otp/send", {
        json: { email: form.email.trim() },
      });
      setOtpSent(true);
      if (res.dev_otp) setDevOtp(res.dev_otp);
      setOtpMsg({ kind: "success", text: res.message || "OTP sent to email address." });
    } catch (err) {
      setOtpMsg({ kind: "error", text: errorMessage(err) });
    } finally {
      setOtpBusy(false);
    }
  }

  async function handleVerifyOtp() {
    if (!otpCode.trim()) {
      setOtpMsg({ kind: "error", text: "Please enter the 6-digit OTP code." });
      return;
    }
    setOtpBusy(true);
    setOtpMsg(null);
    try {
      const res = await api<{ ok: boolean; message: string; verification_token: string }>("/auth/otp/verify", {
        json: { email: form.email.trim(), otp: otpCode.trim() },
      });
      setOtpVerified(true);
      setVerificationToken(res.verification_token);
      setOtpMsg({ kind: "success", text: "✓ Email verified successfully!" });
    } catch (err) {
      setOtpMsg({ kind: "error", text: errorMessage(err) });
    } finally {
      setOtpBusy(false);
    }
  }

  function validate(): boolean {
    const errs: Record<string, string> = {};

    const nameVal = validateField("full_name", form.full_name, true);
    if (!nameVal.isValid) errs.full_name = nameVal.error!;

    const emailVal = validateField("email", form.email, true);
    if (!emailVal.isValid) errs.email = emailVal.error!;

    const passVal = validateField("password", form.password, true);
    if (!passVal.isValid) errs.password = passVal.error!;

    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    if (!otpVerified) {
      setMsg({ kind: "error", text: "Email must be verified with OTP before account provisioning." });
      return;
    }

    setBusy(true);
    setMsg(null);
    try {
      const u = await api<User>("/users", { json: { ...form, verification_token: verificationToken } });
      setMsg({ kind: "success", text: `Successfully created and verified ${u.role} account for ${u.email}.` });
      setForm({ ...EMPTY, role: form.role });
      setOtpSent(false);
      setOtpCode("");
      setOtpVerified(false);
      setVerificationToken(null);
      setDevOtp(null);
      setOtpMsg(null);
      void users.reload();
    } catch (err) {
      setMsg({ kind: "error", text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  async function toggle(u: User) {
    try {
      await api(`/users/${u.id}`, { method: "PATCH", json: { is_active: !u.is_active } });
      void users.reload();
    } catch (err) {
      setMsg({ kind: "error", text: errorMessage(err) });
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="User & Identity Governance"
        subtitle="Manage authenticated identities, assign institutional roles, and govern portal access."
      />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Account Provisioning Card */}
        <Card className="h-fit p-6 bg-[#071126]/90 border-cyan-500/20 shadow-xl">
          <h2 className="mb-4 text-base font-semibold text-white">Issue New Account</h2>
          <form onSubmit={create} className="space-y-4" noValidate>
            <Field label="Full Legal Name" required error={fieldErrors.full_name}>
              <ValidatedInput
                placeholder="e.g. Dr. Robert Chen"
                minLength={2}
                maxLength={100}
                value={form.full_name}
                error={fieldErrors.full_name}
                onChange={(e) => setForm({ ...form, full_name: e.target.value })}
              />
            </Field>

            <Field label="Institutional Email" required error={fieldErrors.email}>
              <div className="space-y-2">
                <div className="flex gap-2">
                  <ValidatedInput
                    type="email"
                    placeholder="user@university.edu"
                    minLength={5}
                    maxLength={254}
                    value={form.email}
                    disabled={otpVerified}
                    error={fieldErrors.email}
                    onChange={(e) => {
                      setForm({ ...form, email: e.target.value });
                      if (otpVerified) {
                        setOtpVerified(false);
                        setVerificationToken(null);
                        setOtpSent(false);
                      }
                    }}
                  />
                  {!otpVerified ? (
                    <Button
                      type="button"
                      variant="secondary"
                      busy={otpBusy}
                      onClick={handleSendOtp}
                      className="whitespace-nowrap text-xs px-3"
                    >
                      {otpSent ? "Resend OTP" : "Send OTP"}
                    </Button>
                  ) : (
                    <span className="inline-flex items-center px-3 text-xs font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
                      ✓ Verified
                    </span>
                  )}
                </div>

                {/* OTP Input & Verification section */}
                {otpSent && !otpVerified && (
                  <div className="p-3 bg-black/40 border border-cyan-500/30 rounded-lg space-y-2">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-300 font-medium">Enter 6-Digit Verification OTP:</span>
                      {devOtp && (
                        <span className="font-mono text-cyan-300 text-[11px] bg-cyan-950/80 px-2 py-0.5 rounded border border-cyan-500/40">
                          Dev Code: {devOtp}
                        </span>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        maxLength={6}
                        placeholder="123456"
                        value={otpCode}
                        onChange={(e) => setOtpCode(e.target.value)}
                        className="w-32 text-center tracking-widest font-mono text-sm rounded-lg border border-slate-700 bg-slate-900/90 px-3 py-1.5 text-cyan-200 focus:border-cyan-400 focus:outline-none"
                      />
                      <Button
                        type="button"
                        variant="primary"
                        busy={otpBusy}
                        onClick={handleVerifyOtp}
                        className="text-xs px-4"
                      >
                        Verify OTP
                      </Button>
                    </div>
                  </div>
                )}

                {otpMsg && (
                  <p className={`text-xs ${otpMsg.kind === "success" ? "text-emerald-400" : "text-rose-400"}`}>
                    {otpMsg.text}
                  </p>
                )}
              </div>
            </Field>

            <Field
              label="Temporary Password"
              required
              hint="Must be strictly 10–15 characters."
              error={fieldErrors.password}
            >
              <PasswordInput
                autoComplete="new-password"
                placeholder="Password (10-15 chars)"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </Field>

            <Field label="Assigned Examination Role">
              <Select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
              >
                {ROLES.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </Field>

            {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

            <Button type="submit" busy={busy} disabled={!otpVerified} className="w-full font-semibold">
              {otpVerified ? "Provision Account" : "Verify Email OTP to Provision"}
            </Button>
          </form>
        </Card>

        {/* User Roster Table */}
        <div className="space-y-4 lg:col-span-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase font-semibold text-slate-400">Filter Role:</span>
              <Select
                className="w-48 text-xs py-1"
                value={filter}
                onChange={(e) => setFilter(e.target.value as Role | "")}
              >
                <option value="">All Institutional Roles</option>
                {ROLES.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </div>
            <span className="text-xs text-slate-400">
              Showing {filteredUsers.length} user{filteredUsers.length === 1 ? "" : "s"}
            </span>
          </div>

          {users.error && <Alert kind="error">{users.error}</Alert>}

          <Card className="p-4 bg-[#071126]/90 border-cyan-500/20">
            <Table
              head={["Identity & Email", "Assigned Role", "Status", "Access Actions"]}
              empty="No matching accounts found."
            >
              {filteredUsers.map((u) => {
                const isSelf = me?.id === u.id;
                return (
                  <tr key={u.id} className="hover:bg-white/[0.02]">
                    <Td>
                      <div className="font-medium text-white">{u.full_name}</div>
                      <div className="text-xs text-slate-500 font-mono">{u.email}</div>
                    </Td>
                    <Td>
                      <Badge value={u.role} />
                    </Td>
                    <Td>
                      {u.is_active ? (
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-400 font-medium">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                          <span className="h-1.5 w-1.5 rounded-full bg-slate-500" /> Suspended
                        </span>
                      )}
                    </Td>
                    <Td>
                      {!isSelf && (
                        <Button
                          variant={u.is_active ? "ghost" : "secondary"}
                          onClick={() => toggle(u)}
                          className="text-xs py-1 px-2.5"
                        >
                          {u.is_active ? "Suspend" : "Activate"}
                        </Button>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </Table>
          </Card>
        </div>
      </div>
    </div>
  );
}
