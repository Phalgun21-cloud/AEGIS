"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loading } from "@/components/ui";

export default function InvigilatorRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/admin/monitoring");
  }, [router]);
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#030712]">
      <Loading label="Redirecting to Unified Admin Proctoring Portal…" />
    </div>
  );
}
