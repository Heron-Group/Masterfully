import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);

// Browser tests against the dev server, using .env.local's dev password.
export default defineConfig({
  testDir: "e2e",
  outputDir: ".cache/playwright",
  globalSetup: "./e2e/global-setup.ts",
  use: { baseURL: `http://localhost:${PORT}` },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["iPhone 15"], defaultBrowserType: "chromium" } },
    // Safari's engine with an iPhone viewport (run: npx playwright install webkit).
    { name: "mobile-safari", use: { ...devices["iPhone 15"] } },
  ],
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
