import { chromium, expect } from "@playwright/test";

const origin = new URL(process.env.SUPERBOARD_LOCAL_URL ?? "http://127.0.0.1:4321");
if (!["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname)) {
	throw new Error("Design checks require a local server.");
}
const browser = await chromium.launch();
try {
	const page = await browser.newPage();
	await page.goto(
		new URL("/_emdash/api/auth/dev-bypass?redirect=/communication/marketing-email", origin).href,
	);
	await page.getByRole("heading", { level: 1 }).waitFor();
	const heading = await page
		.locator("main h1")
		.evaluate((element) => getComputedStyle(element).fontSize);
	expect(heading).toBe("22px");
	const button = page.locator("main header button").first();
	expect(await button.evaluate((element) => getComputedStyle(element).fontSize)).toBe("13px");
	expect(await button.evaluate((element) => element.getBoundingClientRect().height)).toBe(34);
	expect(await button.evaluate((element) => getComputedStyle(element).color)).not.toBe(
		"rgb(255, 255, 255)",
	);
	console.log("Marketing: shared heading and control scale; readable primary action");
} finally {
	await browser.close();
}
