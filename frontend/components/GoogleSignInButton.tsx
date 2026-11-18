"use client";

import { useEffect, useRef, useState } from "react";

// Minimal typing for Google Identity Services (https://accounts.google.com/gsi/client).
type GoogleId = {
  initialize: (opts: {
    client_id: string;
    callback: (resp: { credential?: string }) => void;
    ux_mode?: "popup" | "redirect";
    auto_select?: boolean;
    cancel_on_tap_outside?: boolean;
  }) => void;
  renderButton: (el: HTMLElement, opts: Record<string, unknown>) => void;
};
declare global {
  interface Window {
    google?: { accounts: { id: GoogleId } };
  }
}

const GSI_SRC = "https://accounts.google.com/gsi/client";

function loadGsi(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GSI_SRC}"]`);
    const s = existing ?? document.createElement("script");
    s.addEventListener("load", () => resolve());
    s.addEventListener("error", () => reject(new Error("Google sign-in could not load")));
    if (!existing) {
      s.src = GSI_SRC;
      s.async = true;
      document.head.appendChild(s);
    }
  });
}

/**
 * "Sign in with Google". Renders nothing until the API reports a Google client ID, so the button
 * only appears once Google sign-in is configured on the server.
 */
export function GoogleSignInButton({
  onCredential,
  onError,
  disabled = false,
}: {
  onCredential: (credential: string) => void;
  onError: (message: string) => void;
  disabled?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [clientId, setClientId] = useState<string | null>(null);
  // Held in refs so re-renders of the parent don't re-initialise Google's button.
  const onCredentialRef = useRef(onCredential);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onCredentialRef.current = onCredential;
    onErrorRef.current = onError;
  }, [onCredential, onError]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/config", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg: { google_client_id?: string | null } | null) => {
        if (!cancelled && cfg?.google_client_id) setClientId(cfg.google_client_id);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!clientId || !box.current) return;
    let cancelled = false;
    loadGsi()
      .then(() => {
        if (cancelled || !box.current || !window.google) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          ux_mode: "popup",
          auto_select: false,
          cancel_on_tap_outside: true,
          callback: (resp) => {
            if (resp.credential) onCredentialRef.current(resp.credential);
            else onErrorRef.current("Google sign-in was cancelled.");
          },
        });
        window.google.accounts.id.renderButton(box.current, {
          type: "standard",
          theme: "filled_black",
          size: "large",
          text: "signin_with",
          shape: "pill",
          logo_alignment: "left",
          width: 320,
        });
      })
      .catch((e: Error) => onErrorRef.current(e.message));
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  if (!clientId) return null;
  return (
    <div className={disabled ? "pointer-events-none opacity-60" : ""}>
      <div className="my-5 flex items-center gap-3 text-[11px] uppercase tracking-wider text-slate-500">
        <span className="h-px flex-1 bg-slate-800" />
        or
        <span className="h-px flex-1 bg-slate-800" />
      </div>
      <div ref={box} className="flex justify-center" />
      <p className="mt-2 text-center text-[11px] text-slate-500">
        Only for accounts created by your examination administrator.
      </p>
    </div>
  );
}
