import { NextResponse, type NextRequest } from "next/server";

// Single origin: the browser calls /api/* here and this forwards it to the FastAPI backend.
// Read at request time, so BACKEND_URL doesn't have to be known when the app is built.
const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8000";
// Shared with the API (PROXY_SECRET there). With it set, the API only accepts requests that
// came through this proxy, so it can trust the client IP passed below for rate limiting.
// Server-side only: never prefix it with NEXT_PUBLIC_.
const PROXY_SECRET = process.env.AEGIS_PROXY_SECRET ?? "";

function clientIp(request: NextRequest): string {
  // Vercel sets these from the real connection (and overwrites values sent by the client).
  const real = request.headers.get("x-real-ip");
  if (real) return real.trim();
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded ? forwarded.split(",")[0].trim() : "";
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const target = new URL(pathname.replace(/^\/api/, "") + search, BACKEND_URL);

  const headers = new Headers(request.headers);
  // Always overwrite, so a browser can't supply its own values.
  headers.set("x-aegis-proxy-secret", PROXY_SECRET);
  headers.set("x-aegis-client-ip", clientIp(request));

  return NextResponse.rewrite(target, { request: { headers } });
}

export const config = {
  matcher: "/api/:path*",
};
