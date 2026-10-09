/** @type {import('next').NextConfig} */
const backendUrl = process.env.BACKEND_URL ?? "http://localhost:8000";
const isDev = process.env.NODE_ENV !== "production";

// Next.js inlines small bootstrap scripts, so scripts need 'unsafe-inline' (no nonces without
// middleware); the dev server also needs eval and its hot-reload WebSocket.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ...(isDev
    ? []
    : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]),
];

const nextConfig = {
  // Lets a verification build run beside a live `next dev` without clobbering its .next/.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  poweredByHeader: false,
  // Single origin: the browser talks to /api/* on the frontend, which proxies to FastAPI.
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${backendUrl}/:path*` },
      // Lets the API docs at /api/docs load their schema.
      { source: "/openapi.json", destination: `${backendUrl}/openapi.json` },
    ];
  },
  async headers() {
    // Pages only: proxied /api responses keep the API's own (stricter) headers.
    return [{ source: "/((?!api/).*)", headers: securityHeaders }];
  },
};

export default nextConfig;
