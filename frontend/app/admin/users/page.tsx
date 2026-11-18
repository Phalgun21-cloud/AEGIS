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

  const rawUsers = users.data ?? [];
  const displayUsers = rawUsers;
  const filteredUsers = filter ? displayUsers.filter((u) => u.role === filter) : displayUsers;

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

    setBusy(true);
    setMsg(null);
    try {
      const u = await api<User>("/users", { json: form });
      setMsg({ kind: "success", text: `Created ${u.role} account for ${u.email}. A verification email has been sent; they can sign in once they confirm it.` });
      setForm({ ...EMPTY, role: form.role });
      void users.reload();
    } catch (err) {
      setMsg({ kind: "error", text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  async function resendVerification(u: User) {
    try {
      await api(`/users/${u.id}/resend-verification`, { method: "POST" });
      setMsg({ kind: "success", text: `Verification email sent again to ${u.email}.` });
    } catch (err) {
      setMsg({ kind: "error", text: errorMessage(err) });
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
              <ValidatedInput
                type="email"
                placeholder="user@university.edu"
                minLength={5}
                maxLength={254}
                value={form.email}
                error={fieldErrors.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
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

            <Button type="submit" busy={busy} className="w-full font-semibold">
              Provision Account
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
                      {u.email_verified === false && (
                        <div className="mt-1 inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                          Email not verified
                        </div>
                      )}
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
                      {u.email_verified === false && u.is_active && (
                        <Button variant="secondary" onClick={() => resendVerification(u)} className="mr-2 text-xs py-1 px-2.5">
                          Resend link
                        </Button>
                      )}
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
