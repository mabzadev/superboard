import { appendFileSync } from "node:fs";

import type { Page } from "@playwright/test";

import { test, expect } from "../../fixtures/base-fixtures.js";

const pluginId = "supbrd-plug-settings";
const mainTitle = /^(?:iOS|Android|Web) Setup$/;
const sdkOrigin = process.env.SUPERBOARD_E2E_SDK_URL ?? "https://sdk.autonomy-qa.example.test";
const shortlinkHost = new URL(
	process.env.SUPERBOARD_E2E_SHORTLINK_URL ?? "https://shortlinks.autonomy-qa.example.test",
).hostname;
const apiFailure = /(?:MISSING_MESSAGE|IntlError|hydration|Uncaught)/i;

function record(routeId: string, dataIds: string[], description: string) {
	if (!process.env.SUPERBOARD_E2E_EVIDENCE) return;
	appendFileSync(
		process.env.SUPERBOARD_E2E_EVIDENCE,
		`${JSON.stringify({
			plugin_id: pluginId,
			route_id: routeId,
			scenario: "functional",
			status: "passed",
			type: "browser",
			data_ids: dataIds,
			description,
			evidence_path: "docs/evidence/plugin-autonomy/retirement-sdk-browser.json",
		})}\n`,
	);
}

async function command(page: Page, id: string, method: string, path: string, body?: unknown) {
	return page.request.post(
		`/_emdash/api/superboard/plugins/${pluginId}/commands/${pluginId}.command.${id}`,
		{
			headers: {
				Origin: new URL(page.url()).origin,
				"X-EmDash-Request": "1",
				"Idempotency-Key": crypto.randomUUID(),
			},
			data: { method, path, ...(body === undefined ? {} : { body }) },
		},
	);
}

for (const platform of ["android", "ios", "web"] as const) {
	test(`${platform} SDK setup saves, verifies, reloads and removes its Test configuration`, async ({
		authenticatedPage: page,
	}) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("console", (message) => {
			if (apiFailure.test(message.text())) errors.push(message.text());
		});
		await page.goto(`/app/${platform}-setup`);
		await expect(page.getByRole("heading", { name: mainTitle })).toBeVisible();
		await page.getByRole("combobox", { name: "Environment", exact: true }).selectOption("test");
		const read = page.waitForResponse((response) => {
			if (!response.url().includes("data_source.sdk_configurations")) return false;
			const envelope = JSON.parse(new URL(response.url()).searchParams.get("request") ?? "{}");
			return typeof envelope.path === "string" && envelope.path.endsWith(`-test/setup/${platform}`);
		});
		await page.getByRole("button", { name: "Reload", exact: true }).click();
		const initialResponse = await read;
		expect(initialResponse.ok()).toBe(true);
		const original = (await initialResponse.json()).data;
		const readUrl = initialResponse.url();
		const path = JSON.parse(new URL(readUrl).searchParams.get("request")!).path as string;
		const projectRef = path.split("/")[5]!;
		await expect(page.getByRole("button", { name: "Reload", exact: true })).toBeEnabled();
		const suffix = `r${Date.now()}`;
		const identifier =
			platform === "web"
				? `${suffix}.sdk-retirement.example.test`
				: `com.superboard.retirement.${suffix}`;
		const placeholder = platform === "web" ? "app.example.com" : "com.example.app";
		try {
			await page.getByPlaceholder(placeholder, { exact: true }).fill(identifier);
			if (platform === "android")
				await page
					.getByPlaceholder("AA:BB:CC:…", { exact: true })
					.fill(Array(32).fill("AB").join(":"));
			if (platform === "ios")
				await page.getByPlaceholder("ABCDE12345", { exact: true }).fill("QATEAM1234");
			const save = page.waitForResponse((response) =>
				response.url().includes("command.save_sdk_configuration"),
			);
			await page.getByRole("button", { name: "Save & Continue", exact: true }).click();
			const savedResponse = await save;
			expect(savedResponse.ok(), await savedResponse.text()).toBe(true);
			const storedResponse = await page.request.get(readUrl);
			expect(storedResponse.ok()).toBe(true);
			const stored = (await storedResponse.json()).data;
			expect(
				stored.configuration[
					platform === "android" ? "package_name" : platform === "ios" ? "bundle_id" : "domain"
				],
			).toBe(identifier);
			if (platform === "android")
				await expect(page.locator("main pre").first()).toContainText(shortlinkHost);
			await page.reload();
			await expect(page.getByPlaceholder(placeholder, { exact: true })).toHaveValue(identifier);
			await page
				.getByRole("button", {
					name: platform === "web" ? "Integrate the SDK" : "Initialize SDK",
					exact: false,
				})
				.click();
			await expect(page.locator("main pre").first()).toBeVisible();
			if (platform === "web")
				await expect(page.locator("main pre").first()).toContainText(sdkOrigin);
			const verified = page.waitForResponse((response) =>
				response.url().includes("command.test_sdk_configuration"),
			);
			await page.getByRole("button", { name: "Finish Setup", exact: true }).click();
			expect((await verified).ok()).toBe(true);
			const verifiedData = (await (await page.request.get(readUrl)).json()).data;
			expect(verifiedData.status).toBe("verified");
			expect(verifiedData.verified_at).toBeTruthy();
			await page.reload();
			await expect(page.getByPlaceholder(placeholder, { exact: true })).toHaveValue(identifier);
			await page.getByRole("button", { name: "Remove setup", exact: true }).click();
			await expect(page.getByPlaceholder(placeholder, { exact: true })).toHaveValue("");
			expect((await (await page.request.get(readUrl)).json()).data).toBeNull();
			expect(errors).toEqual([]);
			record(
				`superboard.app_${platform}_setup`,
				[`${projectRef}:${platform}`],
				"Saved registration through the wizard, verified persisted configuration, reloaded its values, checked target-specific SDK instructions and removed the Test configuration.",
			);
		} finally {
			if (original) {
				const restored = await command(
					page,
					"save_sdk_configuration",
					"PUT",
					path,
					original.configuration,
				);
				expect(restored.ok()).toBe(true);
				if (original.status === "verified")
					expect(
						(await command(page, "test_sdk_configuration", "POST", `${path}/test`, {})).ok(),
					).toBe(true);
			}
		}
	});
}
