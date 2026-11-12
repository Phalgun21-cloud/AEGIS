"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

import { Badge, Loading, cx } from "@/components/ui";
import { DEMO_ACCOUNTS } from "@/lib/demoData";
import { HOME, useAuth } from "@/lib/auth";
import type { Role } from "@/lib/types";

export type NavItem = { href: string; label: string };

function hasRoleAccess(userRole: Role, requiredRole: Role): boolean {
  return userRole === requiredRole;
}

export function AppShell({
  role,
  nav,
  children,
}: {
  role: Role;
  nav: NavItem[];
  children: React.ReactNode;
}) {
  const { user, loading, logout, isDemoMode, switchDemoRole } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    } else if (!hasRoleAccess(user.role, role)) {
      router.replace(HOME[user.role] ?? "/login");
    }
  }, [loading, user, role, router, pathname]);

  if (loading || !user || !hasRoleAccess(user.role, role)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#030712]">
        <Loading label="Verifying role permissions…" />
      </div>
    );
  }

  const active = (href: string) =>
    href === HOME[role] ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className="flex min-h-screen flex-col md:flex-row bg-[#030712] text-slate-100">
      <aside className="border-b border-cyan-500/10 bg-[#040916] md:w-64 md:shrink-0 md:border-b-0 md:border-r">
        <div className="flex items-center justify-between px-5 py-4 md:block">
          <Link href={HOME[role]} className="text-lg font-bold tracking-[0.3em] text-cyan-300">
            AEGIS
          </Link>
          <div className="text-[10px] uppercase tracking-widest text-slate-500 md:mt-1">
            Examination Infrastructure
          </div>
          {isDemoMode && (
            <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-0.5 text-[10px] font-semibold text-amber-300">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
              DEMO SANDBOX
            </div>
          )}
        </div>

        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:pb-0">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cx(
                "whitespace-nowrap rounded-lg px-3 py-2 text-sm transition",
                active(item.href)
                  ? "bg-cyan-500/15 font-medium text-cyan-200 border-l-2 border-cyan-400"
                  : "text-slate-400 hover:bg-white/5 hover:text-slate-200",
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        {isDemoMode && (
          <div className="mt-auto hidden border-t border-cyan-500/10 p-3 md:block">
            <div className="mb-2 text-[10px] uppercase tracking-wider text-slate-500">
              Switch Role (Demo)
            </div>
            <div className="flex flex-col gap-1">
              {DEMO_ACCOUNTS.map((acc) => (
                <button
                  key={acc.role}
                  onClick={() => switchDemoRole(acc.role)}
                  className={cx(
                    "flex items-center justify-between rounded px-2 py-1 text-xs text-left transition",
                    user.role === acc.role
                      ? "bg-cyan-500/20 text-cyan-200 font-medium"
                      : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
                  )}
                >
                  <span className="truncate">{acc.roleName}</span>
                  {user.role === acc.role && <span className="text-[10px] text-cyan-400">●</span>}
                </button>
              ))}
            </div>
          </div>
        )}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/10 px-6 py-3 bg-[#040916]/80 backdrop-blur">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span>AEGIS Portal</span>
            <span>/</span>
            <span className="capitalize font-medium text-slate-200">{role.replace(/_/g, " ")}</span>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-sm font-medium text-slate-200">{user.full_name}</div>
              <div className="text-xs text-slate-500">{user.email}</div>
            </div>
            <Badge value={user.role} />
            <button
              onClick={logout}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-rose-500/10 hover:border-rose-500/40 hover:text-rose-200 transition"
            >
              Sign out
            </button>
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 md:px-8">{children}</main>
      </div>
    </div>
  );
}
