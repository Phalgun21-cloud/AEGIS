"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState } from "react";

import { api, setSessionActive } from "@/lib/api";
import type { Role, User } from "@/lib/types";

type AuthState = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  loginWithGoogle: (credential: string) => Promise<User>;
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

  // Restore the session from the httpOnly cookie, if there is one.
  useEffect(() => {
    // Clear any leftover session from the old browser-only demo mode.
    try {
      sessionStorage.removeItem("aegis_demo_user");
    } catch {
      /* storage unavailable */
    }
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

  const login = useCallback(async (email: string, password: string): Promise<User> => {
    const form = new URLSearchParams({ username: email.trim().toLowerCase(), password });
    await api("/auth/login", { form }); // sets the httpOnly session cookie
    const me = await api<User>("/auth/me");
    setSessionActive(true);
    setUser(me);
    return me;
  }, []);

  // Google proves who the person is; the server only signs in accounts an admin created.
  const loginWithGoogle = useCallback(async (credential: string): Promise<User> => {
    await api("/auth/google", { json: { credential } }); // sets the httpOnly session cookie
    const me = await api<User>("/auth/me");
    setSessionActive(true);
    setUser(me);
    return me;
  }, []);

  return <AuthContext.Provider value={{ user, loading, login, loginWithGoogle, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
