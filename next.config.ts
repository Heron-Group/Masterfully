import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // Self-contained server build for Plesk/Passenger and Docker.
  output: "standalone",
  poweredByHeader: false,
  async redirects() {
    return [{ source: "/", destination: "/journal", permanent: false }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
