import type { NextConfig } from "next";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "https://api.akaidon.market";

const nextConfig: NextConfig = {
  output: "standalone",
  devIndicators: false,
  images: {
    unoptimized: true,
  },
  async rewrites() {
    return [
      { source: "/api/health", destination: `${API_BASE}/health` },
      { source: "/api/config", destination: `${API_BASE}/config` },
      { source: "/api/deals", destination: `${API_BASE}/deals` },
      { source: "/api/stats", destination: `${API_BASE}/stats` },
      { source: "/api/jobs", destination: `${API_BASE}/jobs` },
      { source: "/api/generate-image", destination: `${API_BASE}/generate-image` },
      { source: "/api/api/deals/:id/optimize-text", destination: `${API_BASE}/api/deals/:id/optimize-text` },
    ];
  },
};

export default nextConfig;
