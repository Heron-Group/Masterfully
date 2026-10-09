import type { NextConfig } from "next";

// GitHub Codespaces serves the dev server from https://<name>-<port>.app.github.dev.
// Allow that origin for dev assets and server actions (login form), in development only.
const codespacesDomain =
  process.env.NODE_ENV !== "production" ? process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN : undefined;

const nextConfig: NextConfig = {
  ...(codespacesDomain && {
    allowedDevOrigins: [`*.${codespacesDomain}`],
    experimental: { serverActions: { allowedOrigins: [`*.${codespacesDomain}`] } },
  }),
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
