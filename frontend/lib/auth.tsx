"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState } from "react";

import { api, getToken, setToken } from "@/lib/api";
import type { Role, User } from "@/lib/types";

type AuthState = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  logout: () => void;
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

  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return;
    }
    api<User>("/auth/me")
      .then(setUser)
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  const logout = useCallback(() => {
    setToken(null);
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
    const res = await api<{ access_token: string }>("/auth/login", { form });
    setToken(res.access_token);
    const me = await api<User>("/auth/me");
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
