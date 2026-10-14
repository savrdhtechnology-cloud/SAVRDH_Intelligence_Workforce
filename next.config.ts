import type { NextConfig } from "next";

const basePath = "/savrdhintelligenceworkforce";

const nextConfig: NextConfig = {
  basePath,
  // Client code needs the base path for fetch("/api/...") calls; Next.js only
  // prefixes <Link> and router navigation automatically, not fetch.
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
};

export default nextConfig;
