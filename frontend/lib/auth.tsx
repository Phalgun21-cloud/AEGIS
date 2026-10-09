"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState } from "react";

import { api, setSessionActive } from "@/lib/api";
import type { Role, User } from "@/lib/types";

type AuthState = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export const HOME: Record<Role, string> = {
  admin: "/admin",
  author: "/author",
  reviewer: "/reviewer",
  candidate: "/candidate",
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  // The session cookie is httpOnly, so ask the API who (if anyone) is signed in.
  useEffect(() => {
    api<User>("/auth/me")
      .then((me) => {
        setSessionActive(true);
        setUser(me);
      })
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const logout = useCallback(async () => {
    setSessionActive(false);
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    setUser(null);
    router.replace("/login");
  }, [router]);

  useEffect(() => {
    const onExpired = () => {
      setUser(null);
      router.replace("/login?expired=1");
    };
    window.addEventListener("aegis:logout", onExpired);
    return () => window.removeEventListener("aegis:logout", onExpired);
  }, [router]);

  const login = useCallback(async (email: string, password: string) => {
    const form = new URLSearchParams({ username: email, password });
    await api("/auth/login", { form }); // sets the session cookie
    const me = await api<User>("/auth/me");
    setSessionActive(true);
    setUser(me);
    return me;
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
