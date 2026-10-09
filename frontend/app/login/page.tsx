"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { Alert, Button, Card, Field, Input } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { HOME, useAuth } from "@/lib/auth";

function LoginForm() {
  const { user, loading, login } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Only follow same-site relative paths after login.
  const next = params.get("next");
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : null;

  useEffect(() => {
    if (!loading && user) router.replace(safeNext ?? HOME[user.role]);
  }, [loading, user, router, safeNext]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(errorMessage(err));
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="w-full max-w-sm p-8">
      <Link href="/" className="block text-center text-2xl font-bold tracking-[0.3em] text-cyan-300">
        AEGIS
      </Link>
      <p className="mt-1 text-center text-xs uppercase tracking-widest text-slate-500">
        Sign in to continue
      </p>
      <form onSubmit={onSubmit} className="mt-8 space-y-4">
        {params.get("expired") && !error && (
          <Alert kind="info">Your session expired. Please sign in again.</Alert>
        )}
        {error && <Alert>{error}</Alert>}
        <Field label="Email">
          <Input
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label="Password">
          <Input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <Button type="submit" busy={busy} className="w-full">
          Sign in
        </Button>
      </form>
      <p className="mt-6 text-center text-xs text-slate-500">
        Accounts are issued by your examination administrator.
      </p>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
