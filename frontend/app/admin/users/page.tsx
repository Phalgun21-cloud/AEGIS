"use client";

import { useState } from "react";

import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, Table, Td } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Role, User } from "@/lib/types";
import { useApi } from "@/lib/useApi";

const ROLES: Role[] = ["admin", "author", "reviewer", "candidate"];
const EMPTY = { email: "", full_name: "", password: "", role: "candidate" as Role };

export default function UsersPage() {
  const { user: me } = useAuth();
  const [filter, setFilter] = useState<Role | "">("");
  const users = useApi<User[]>(`/users${filter ? `?role=${filter}` : ""}`);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const u = await api<User>("/users", { json: form });
      setMsg({ kind: "success", text: `Created ${u.role} account for ${u.email}.` });
      setForm({ ...EMPTY, role: form.role });
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
    <>
      <PageHeader title="Users" subtitle="Accounts are issued here; there is no public sign-up." />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="h-fit">
          <h2 className="mb-4 font-medium text-white">New account</h2>
          <form onSubmit={create} className="space-y-4">
            <Field label="Full name">
              <Input required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
            </Field>
            <Field label="Email">
              <Input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
            <Field label="Initial password" hint="10–15 characters. Share it with the user securely.">
              <Input
                type="password"
                autoComplete="new-password"
                required
                minLength={10}
                maxLength={15}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </Field>
            <Field label="Role">
              <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </Select>
            </Field>
            {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
            <Button type="submit" busy={busy} className="w-full">
              Create account
            </Button>
          </form>
        </Card>

        <div className="space-y-3 lg:col-span-2">
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-400">Show</span>
            <Select className="w-40" value={filter} onChange={(e) => setFilter(e.target.value as Role | "")}>
              <option value="">all roles</option>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}s
                </option>
              ))}
            </Select>
          </div>
          {users.error && <Alert>{users.error}</Alert>}
          <Table head={["Name", "Role", "Status", ""]} empty="No users.">
            {(users.data ?? []).map((u) => (
              <tr key={u.id}>
                <Td>
                  <div>{u.full_name}</div>
                  <div className="text-xs text-slate-500">
                    #{u.id} · {u.email}
                  </div>
                </Td>
                <Td>
                  <Badge value={u.role} />
                </Td>
                <Td>{u.is_active ? <span className="text-emerald-300">Active</span> : <span className="text-slate-500">Deactivated</span>}</Td>
                <Td className="text-right">
                  {u.id !== me?.id && (
                    <Button variant={u.is_active ? "ghost" : "secondary"} onClick={() => toggle(u)}>
                      {u.is_active ? "Deactivate" : "Reactivate"}
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        </div>
      </div>
    </>
  );
}
