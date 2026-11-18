"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";

import { Card } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";

type State = { kind: "checking" } | { kind: "ok"; email: string } | { kind: "error"; message: string };

function Verify() {
  const params = useSearchParams();
  const token = params.get("token");
  const [state, setState] = useState<State>(
    token ? { kind: "checking" } : { kind: "error", message: "This page needs the link from your verification email." },
  );
  const sent = useRef(false); // React may run effects twice in development; verify once

  useEffect(() => {
    if (!token || sent.current) return;
    sent.current = true;
    api<{ verified: boolean; email: string }>("/auth/verify-email", { json: { token } })
      .then((r) => setState({ kind: "ok", email: r.email }))
      .catch((e) => setState({ kind: "error", message: errorMessage(e) }));
  }, [token]);

  return (
    <Card className="w-full max-w-md p-8 text-center bg-[#071126]/90 border-cyan-500/20">
      <Link href="/" className="block text-3xl font-bold tracking-[0.3em] text-cyan-300">
        AEGIS
      </Link>
      <h1 className="mt-6 text-lg font-semibold text-white">Email verification</h1>
      {state.kind === "checking" && <p className="mt-4 text-sm text-slate-400">Verifying your email address…</p>}
      {state.kind === "ok" && (
        <>
          <p className="mt-4 text-sm text-emerald-300">Your email address {state.email} is verified.</p>
          <Link
            href="/login"
            className="mt-6 inline-block rounded-lg bg-cyan-500 px-5 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400"
          >
            Sign in
          </Link>
        </>
      )}
      {state.kind === "error" && (
        <>
          <p className="mt-4 text-sm text-rose-300">{state.message}</p>
          <Link href="/login" className="mt-6 inline-block text-sm text-cyan-300 underline">
            Go to sign in to request a new link
          </Link>
        </>
      )}
    </Card>
  );
}

export default function VerifyEmailPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#020617] px-4 text-slate-100">
      <Suspense>
        <Verify />
      </Suspense>
    </main>
  );
}
