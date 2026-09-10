import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.SUPERBOARD_E2E_URL ?? "http://localhost:9202";
export default defineConfig({
	testDir: "../../tests/e2e/site",
	testMatch: "**/*.spec.ts",
	outputDir: process.env.SUPERBOARD_E2E_OUTPUT ?? "test-results",
	snapshotPathTemplate: "{testDir}/{testFilePath}-snapshots/{arg}{ext}",
	fullyParallel: false,
	forbidOnly: Boolean(process.env.CI),
	retries: 0,
	workers: 1,
	timeout: 60_000,
	reporter: [
		["list"],
		["json", { outputFile: process.env.SUPERBOARD_E2E_REPORT ?? "test-results/site-e2e.json" }],
	],
	use: {
		baseURL,
		actionTimeout: 10000,
		navigationTimeout: 20000,
		trace: "off",
		screenshot: "off",
		video: "off",
	},
	projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], channel: "chrome" } }],
});
