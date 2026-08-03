import { defineConfig, devices } from "@playwright/test";

const realBackend = process.env.PLAYWRIGHT_REAL_BACKEND === "1";
const workerPort = process.env.PLAYWRIGHT_WORKER_PORT || "8787";
const workerUrl = process.env.PLAYWRIGHT_API_URL || `http://127.0.0.1:${workerPort}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "html" : "list",
  timeout: 30_000,

  use: {
    baseURL: "http://localhost:3001",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "on-first-retry",
  },

  projects: realBackend
    ? [
        {
          name: "chromium",
          testMatch: /real\/.*\.spec\.ts/,
          use: { ...devices["Desktop Chrome"] },
        },
      ]
    : [
        {
          name: "setup",
          testMatch: /auth\.setup\.ts/,
        },
        {
          name: "chromium",
          use: { ...devices["Desktop Chrome"] },
          dependencies: ["setup"],
        },
        ...(process.env.CI
          ? []
          : [
              {
                name: "firefox",
                use: { ...devices["Desktop Firefox"] },
                dependencies: ["setup"],
              },
            ]),
      ],

  webServer: realBackend
    ? [
        {
          command: `cd ../../workers/opengrow && npm run migrate:local && npx wrangler dev --port ${workerPort}`,
          url: `${workerUrl}/health`,
          reuseExistingServer: true,
          timeout: 120_000,
        },
        {
          command: `NEXT_PUBLIC_API_URL=${workerUrl} NEXT_PUBLIC_API_PATH=/api/v1 NEXT_PUBLIC_CLIENT_ID=opengrow-dashboard-vocostar CLIENT_SECRET=dashboard-secret npm run dev`,
          url: "http://localhost:3001",
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
      ]
    : {
        command: "npm run dev",
        url: "http://localhost:3001",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
