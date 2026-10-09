import { AppShell } from "@/components/AppShell";

const NAV = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/exams", label: "Exams" },
  { href: "/admin/bank", label: "Question Bank" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/audit", label: "Audit Logs" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell role="admin" nav={NAV}>
      {children}
    </AppShell>
  );
}
