import { AppShell } from "@/components/AppShell";

const NAV = [{ href: "/candidate", label: "My Exams" }];

export default function CandidateLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell role="candidate" nav={NAV}>
      {children}
    </AppShell>
  );
}
