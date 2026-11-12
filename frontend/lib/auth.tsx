"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState } from "react";

import { api, setSessionActive } from "@/lib/api";
import { DEMO_ACCOUNTS } from "@/lib/demoData";
import type { Role, User } from "@/lib/types";

type AuthState = {
  user: User | null;
  loading: boolean;
  isDemoMode: boolean;
  setDemoMode: (val: boolean) => void;
  login: (email: string, password: string, forceDemo?: boolean) => Promise<User>;
  logout: () => Promise<void>;
  switchDemoRole: (role: Role) => void;
};

const AuthContext = createContext<AuthState | null>(null);

export const HOME: Record<Role, string> = {
  admin: "/admin",
  author: "/author",
  reviewer: "/reviewer",
  candidate: "/candidate",
};

const DEMO_STORAGE_KEY = "aegis_demo_user";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isDemoMode, setIsDemoMode] = useState(false);
  const router = useRouter();

  // Restore session: checks API first; falls back to demo mode if stored
  useEffect(() => {
    // Check if demo session is stored in sessionStorage
    if (typeof window !== "undefined") {
      const savedDemo = sessionStorage.getItem(DEMO_STORAGE_KEY);
      if (savedDemo) {
        try {
          const parsed = JSON.parse(savedDemo) as User;
          setUser(parsed);
          setIsDemoMode(true);
          setLoading(false);
          return;
        } catch {
          sessionStorage.removeItem(DEMO_STORAGE_KEY);
        }
      }
    }

    // Otherwise probe the real backend API
    api<User>("/auth/me")
      .then((me) => {
        setSessionActive(true);
        setUser(me);
        setIsDemoMode(false);
      })
      .catch(() => {
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const logout = useCallback(async () => {
    setSessionActive(false);
    if (typeof window !== "undefined") {
      sessionStorage.removeItem(DEMO_STORAGE_KEY);
    }
    if (!isDemoMode) {
      await api("/auth/logout", { method: "POST" }).catch(() => { });
    }
    setUser(null);
    router.replace("/login");
  }, [isDemoMode, router]);

  useEffect(() => {
    const onExpired = () => {
      setUser(null);
      if (typeof window !== "undefined") {
        sessionStorage.removeItem(DEMO_STORAGE_KEY);
      }
      router.replace("/login?expired=1");
    };
    window.addEventListener("aegis:logout", onExpired);
    return () => window.removeEventListener("aegis:logout", onExpired);
  }, [router]);

  const login = useCallback(
    async (email: string, password: string, forceDemo: boolean = false): Promise<User> => {
      const normalizedEmail = email.trim().toLowerCase();

      // Check demo accounts first if forceDemo or if email matches demo domain
      const demoMatch = DEMO_ACCOUNTS.find(
        (a) => a.email.toLowerCase() === normalizedEmail
      );

      if (forceDemo || demoMatch) {
        if (!demoMatch) {
          throw new Error("Demo account not found for: " + email);
        }
        if (password.length < 8) {
          throw new Error("Demo passwords must be at least 8 characters.");
        }
        const demoUser: User = {
          id: Math.floor(Math.random() * 1000) + 100,
          email: demoMatch.email,
          full_name: demoMatch.name,
          role: demoMatch.role,
          is_active: true,
        };
        setUser(demoUser);
        setIsDemoMode(true);
        if (typeof window !== "undefined") {
          sessionStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(demoUser));
        }
        return demoUser;
      }

      // Production login via FastAPI /auth/login
      try {
        const form = new URLSearchParams({ username: normalizedEmail, password });
        await api("/auth/login", { form }); // Sets httpOnly session cookie
        const me = await api<User>("/auth/me");
        setSessionActive(true);
        setUser(me);
        setIsDemoMode(false);
        if (typeof window !== "undefined") {
          sessionStorage.removeItem(DEMO_STORAGE_KEY);
        }
        return me;
      } catch (err) {
        // If API is unreachable, suggest demo mode or throw error
        throw err;
      }
    },
    []
  );

  const switchDemoRole = useCallback(
    (role: Role) => {
      const demoAccount = DEMO_ACCOUNTS.find((a) => a.role === role) ?? DEMO_ACCOUNTS[0];
      const nextUser: User = {
        id: Math.floor(Math.random() * 1000) + 100,
        email: demoAccount.email,
        full_name: demoAccount.name,
        role: demoAccount.role,
        is_active: true,
      };
      setUser(nextUser);
      setIsDemoMode(true);
      if (typeof window !== "undefined") {
        sessionStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(nextUser));
      }
      router.replace(HOME[role]);
    },
    [router]
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isDemoMode,
        setDemoMode: setIsDemoMode,
        login,
        logout,
        switchDemoRole,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
