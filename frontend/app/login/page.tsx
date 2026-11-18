"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { Alert, Button, Card, Field, Input, PasswordInput } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { HOME, useAuth } from "@/lib/auth";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function LoginForm() {
  const { user, loading, login } = useAuth();
  const router = useRouter();
  const params = useSearchParams();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Follow safe same-site relative path or default role dashboard
  const next = params.get("next");
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : null;

  useEffect(() => {
    if (!loading && user) {
      router.replace(safeNext ?? HOME[user.role] ?? "/admin");
    }
  }, [loading, user, router, safeNext]);

  function validate(): boolean {
    let valid = true;

    // Email validation
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setEmailError("Email address is required.");
      valid = false;
    } else if (!EMAIL_REGEX.test(trimmedEmail)) {
      setEmailError("Please enter a valid email address (e.g. user@domain.com).");
      valid = false;
    } else {
      setEmailError(null);
    }

    // Password validation
    if (!password) {
      setPasswordError("Password is required.");
      valid = false;
    } else if (password.length < 10) {
      setPasswordError("Password must be at least 10 characters long.");
      valid = false;
    } else if (password.length > 15) {
      setPasswordError("Password cannot exceed 15 characters.");
      valid = false;
    } else {
      setPasswordError(null);
    }

    return valid;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setServerError(null);

    if (!validate()) return;

    setBusy(true);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setServerError(errorMessage(err));
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="w-full max-w-md p-8 bg-[#071126]/90 border-cyan-500/20 backdrop-blur-md">
      <Link href="/" className="block text-center text-3xl font-bold tracking-[0.3em] text-cyan-300">
        AEGIS
      </Link>
      <p className="mt-1 text-center text-xs uppercase tracking-widest text-slate-400">
        Secure Digital Examination Infrastructure
      </p>

      <form onSubmit={onSubmit} className="mt-8 space-y-4" noValidate>
        {params.get("expired") && !serverError && (
          <Alert kind="warning">Your session expired or was terminated. Please sign in again.</Alert>
        )}

        {serverError && <Alert kind="error">{serverError}</Alert>}

        <Field label="Email Address" required error={emailError}>
          <Input
            type="email"
            autoComplete="username"
            placeholder="examiner@university.edu"
            value={email}
            disabled={busy}
            onChange={(e) => {
              setEmail(e.target.value);
              if (emailError) setEmailError(null);
            }}
          />
        </Field>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
              Password <span className="text-rose-400">*</span>
            </span>
          </div>
          <PasswordInput
            autoComplete="current-password"
            placeholder="••••••••••••"
            value={password}
            disabled={busy}
            onChange={(e) => {
              setPassword(e.target.value);
              if (passwordError) setPasswordError(null);
            }}
          />
          {passwordError ? (
            <p className="text-xs text-rose-400">{passwordError}</p>
          ) : (
            <p className="text-[11px] text-slate-500">AEGIS passwords are 10–15 characters.</p>
          )}
        </div>

        <Button type="submit" busy={busy} className="w-full mt-2" variant="primary">
          Sign In to Examination Portal
        </Button>
      </form>

      <p className="mt-6 text-center text-xs text-slate-400">
        Forgot your password? Contact your examination administrator.
      </p>
      <p className="mt-2 text-center text-xs text-slate-500">
        Account authentication is cryptographically audited and verified by AEGIS Vault.
      </p>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12 bg-[#020617] text-slate-100">
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
