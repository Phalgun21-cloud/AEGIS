import Link from "next/link";

import { fetchHealth } from "@/lib/api";

export const dynamic = "force-dynamic";

const pillars = ["Secure", "Transparent", "Traceable", "Scalable"];

function Status({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-cyan-500/20 bg-white/5 px-4 py-2 text-sm">
      <span className={`h-2 w-2 rounded-full ${ok ? "bg-emerald-400" : "bg-amber-400"}`} />
      <span>{label}</span>
      <span className="text-slate-400">{ok ? "online" : "unreachable"}</span>
    </div>
  );
}

export default async function Home() {
  const [api, db] = await Promise.all([fetchHealth("/health"), fetchHealth("/health/db")]);

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-8 px-6 text-center">
      <h1 className="text-5xl font-bold tracking-[0.3em] text-cyan-300">AEGIS</h1>
      <p className="text-sm uppercase tracking-widest text-slate-300">
        Secure Digital Examination Infrastructure
      </p>
      <p className="text-lg italic text-slate-400">&ldquo;Integrity in Every Examination.&rdquo;</p>
      <ul className="flex flex-wrap justify-center gap-3">
        {pillars.map((p) => (
          <li key={p} className="rounded-full border border-cyan-500/30 px-4 py-1 text-xs uppercase tracking-wider">
            {p}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap justify-center gap-3">
        <Status label="API" ok={api?.status === "ok"} />
        <Status label="Database" ok={db?.database === "up"} />
      </div>
      {api?.status !== "ok" ? (
        <p className="max-w-md text-sm text-amber-300/90">
          The API isn&apos;t running. Double-click{" "}
          <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono">start-aegis.cmd</code> in the project folder
          (or run <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono">npm run dev</code> there), then
          refresh this page.
        </p>
      ) : db?.database !== "up" ? (
        <p className="max-w-md text-sm text-amber-300/90">
          The API can&apos;t reach MySQL. Check that the MySQL80 service is running and that{" "}
          <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono">DATABASE_URL</code> in backend/.env is correct.
        </p>
      ) : null}
      <Link
        href="/login"
        className="rounded-lg bg-cyan-500 px-6 py-2.5 text-sm font-medium text-slate-950 transition hover:bg-cyan-400"
      >
        Sign in
      </Link>
    </main>
  );
}
