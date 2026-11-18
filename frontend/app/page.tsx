import Link from "next/link";

import { fetchHealth } from "@/lib/api";

export const dynamic = "force-dynamic";

const pillars = [
  "Cryptographically Sealed Vault",
  "5-State Question Palette",
  "Automated Proctoring & Timers",
  "SHA-256 Audit Chaining",
  "Role-Based Access Governance",
];

function Status({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-cyan-500/20 bg-white/[0.04] px-4 py-2 text-xs font-medium">
      <span className={`h-2 w-2 rounded-full ${ok ? "bg-emerald-400" : "bg-amber-400"}`} />
      <span className="text-slate-300">{label}:</span>
      <span className={ok ? "text-emerald-400 font-semibold" : "text-amber-400 font-semibold"}>
        {ok ? "Online" : "Unreachable"}
      </span>
    </div>
  );
}

export default async function Home() {
  const [api, db] = await Promise.all([fetchHealth("/health"), fetchHealth("/health/db")]);

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col items-center justify-center gap-8 px-6 py-12 text-center text-slate-100">
      <div className="space-y-3">
        <h1 className="text-6xl font-extrabold tracking-[0.35em] text-cyan-300 drop-shadow-md">
          AEGIS
        </h1>
        <p className="text-xs uppercase tracking-widest text-slate-400 font-medium">
          Secure Digital Examination Infrastructure
        </p>
        <p className="text-lg italic text-slate-300">&ldquo;Integrity in Every Examination.&rdquo;</p>
      </div>

      <ul className="flex flex-wrap justify-center gap-2.5 max-w-2xl">
        {pillars.map((p) => (
          <li
            key={p}
            className="rounded-full border border-cyan-500/30 bg-cyan-500/5 px-3.5 py-1 text-xs font-medium text-cyan-200"
          >
            {p}
          </li>
        ))}
      </ul>

      {/* Backend & Database Connectivity Status Badges */}
      <div className="flex flex-wrap justify-center gap-3">
        <Status label="Backend API" ok={api?.status === "ok"} />
        <Status label="Vault Database" ok={db?.database === "up"} />
      </div>

      {/* Quick Action Navigation Buttons */}
      <div className="flex flex-wrap items-center justify-center gap-4 mt-2">
        <Link
          href="/login"
          className="rounded-xl bg-cyan-500 px-8 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 shadow-lg shadow-cyan-500/20"
        >
          Sign In to Examination Portal →
        </Link>
      </div>

    </main>
  );
}
