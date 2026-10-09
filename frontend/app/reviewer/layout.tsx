import { AppShell } from "@/components/AppShell";

const NAV = [{ href: "/reviewer", label: "Review Queue" }];

export default function ReviewerLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell role="reviewer" nav={NAV}>
      {children}
    </AppShell>
  );
}
