import { chromium, expect } from "@playwright/test";

const origin = new URL(process.env.SUPERBOARD_LOCAL_URL ?? "http://127.0.0.1:4321");
if (!["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname)) {
	throw new Error("The local plugin test requires a loopback URL.");
}
const browser = await chromium.launch();
try {
	const page = await browser.newPage();
	await page.goto(
		new URL("/_emdash/api/setup/dev-bypass?redirect=/_emdash/admin/plugins-manager", origin).href,
	);
	const welcome = page.getByRole("button", { name: /^(Commencer|Get started)$/ });
	if (await welcome.isVisible()) await welcome.click();
	const heading = page.getByRole("heading", { name: "Communication", exact: true });
	await expect(heading).toBeVisible({ timeout: 60000 });
	await expect(page.getByRole("heading", { name: /vocostar/i })).toHaveCount(0);
	const toggle = page
		.locator("div")
		.filter({ has: heading })
		.filter({ has: page.getByRole("switch") })
		.last()
		.getByRole("switch");
	const initial = (await toggle.getAttribute("aria-checked")) === "true";
	for (const enabled of [!initial, initial]) {
		const action = enabled ? "enable" : "disable";
		const pending = page.waitForResponse(
			(response) =>
				response.url().endsWith(`/plugins/supbrd-plug-communication/${action}`) &&
				response.request().method() === "POST",
			{ timeout: 60000 },
		);
		await toggle.click();
		const response = await pending;
		expect([200, 201], await response.text()).toContain(response.status());
		await expect(toggle).toHaveAttribute("aria-checked", String(enabled));
		await page.reload();
		await expect(toggle).toHaveAttribute("aria-checked", String(enabled), { timeout: 30000 });
	}
	console.log(
		"Local EmDash: plugin activation, deactivation and persistence passed; no application addon is installed.",
	);
} finally {
	await browser.close();
}
