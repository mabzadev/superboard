import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: "./tests/e2e/emdash",
	fullyParallel: false,
	workers: 1,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	reporter: "html",
	timeout: process.env.EMDASH_E2E_TARGET === "cloudflare" ? 90_000 : 30000,

	globalSetup: "./tests/e2e/emdash/global-setup.ts",
	globalTeardown: "./tests/e2e/emdash/global-teardown.ts",

	use: {
		baseURL: "http://localhost:4444",
		trace: "on-first-retry",
		screenshot: "only-on-failure",
	},

	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
		},
	],
});
