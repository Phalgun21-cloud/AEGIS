import { AppShell } from "@/components/AppShell";

const NAV = [
  { href: "/author", label: "My Questions" },
  { href: "/author/new", label: "New Question" },
];

export default function AuthorLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell role="author" nav={NAV}>
      {children}
    </AppShell>
  );
}
