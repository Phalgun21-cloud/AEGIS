/** @type {import('next').NextConfig} */
const backendUrl = process.env.BACKEND_URL ?? "http://localhost:8000";

const nextConfig = {
  // Lets a verification build run beside a live `next dev` without clobbering its .next/.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Single origin: the browser talks to /api/* on the frontend, which proxies to FastAPI.
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${backendUrl}/:path*` },
      // Lets the API docs at /api/docs load their schema.
      { source: "/openapi.json", destination: `${backendUrl}/openapi.json` },
    ];
  },
};

export default nextConfig;
