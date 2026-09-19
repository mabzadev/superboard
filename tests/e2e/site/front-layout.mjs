import { chromium, expect } from "@playwright/test";

const origin = new URL(process.env.SUPERBOARD_LOCAL_URL ?? "http://127.0.0.1:4321");
if (!["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname)) {
	throw new Error("Front layout checks require a local development server.");
}

const paths = [
	"/paywalls",
	"/marketing/channels",
	"/dynamic-links/links",
	"/support/inbox",
	"/onboardings",
	"/flows/workflows",
	"/analytics/reports",
	"/app/access-key",
];
const browser = await chromium.launch();
try {
	const page = await browser.newPage({ viewport: { width: 1415, height: 1260 } });
	page.setDefaultTimeout(30000);
	await page.goto(
		new URL("/_emdash/api/auth/dev-bypass?redirect=%2Fsuperboard-system%2Fhome", origin).href,
	);
	await expect(page.getByRole("heading", { name: /^(Overview|Vue d’ensemble)$/u })).toBeVisible();
	for (const locale of ["en", "fr"]) {
		await page.goto(new URL(`/superboard-system/home?lang=${locale}`, origin).href);
		const french = locale === "fr";
		const adminName = french ? "Administration de la plateforme" : "Platform administration";
		const languageName = french ? "Langue" : "Language";
		const account = page.getByRole("button", {
			name: /^(Open .* account menu|Ouvrir le menu du compte de .*)$/u,
		});
		await expect(account).toBeVisible();
		await expect(page.getByRole("link", { name: adminName, exact: true })).toHaveCount(0);
		await expect(page.getByRole("combobox", { name: languageName, exact: true })).toHaveCount(0);
		const header = page.locator(".native-front-content > header");
		await expect(header).not.toContainText("https://api.mbza.dev");
		await expect(header.getByText("Local", { exact: true })).toHaveCount(0);
		await account.click();
		const panel = page.getByRole("dialog", {
			name: "Dev Admin",
			exact: true,
		});
		await expect(panel.getByRole("link", { name: adminName, exact: true })).toHaveAttribute(
			"href",
			"/_emdash/admin",
		);
		const language = panel.getByRole("combobox", { name: languageName, exact: true });
		await language.focus();
		await language.press("ArrowDown");
		await expect(page.getByRole("option", { name: "English", exact: true })).toBeVisible();
		await expect(page.getByRole("option", { name: "Français", exact: true })).toBeVisible();
		await page.getByRole("option", { name: french ? "English" : "Français", exact: true }).click();
		await expect(page).toHaveURL(new RegExp(`lang=${french ? "en" : "fr"}`));
		console.log(`${locale}: account panel owns administration and working language selection`);
	}

	const usersResponse = page.waitForResponse((response) => {
		const path = new URL(response.url()).pathname;
		return (
			response.request().method() === "GET" &&
			path.includes("/application-users/") &&
			path.endsWith("/users")
		);
	});
	await page.goto(new URL("/app/users", origin).href);
	expect((await usersResponse).status()).toBe(200);
	await expect(page.getByText("PLUGIN_TASK_AUTHORITY_UNAVAILABLE", { exact: true })).toHaveCount(0);
	await expect(page.getByRole("table")).toBeVisible();

	for (const locale of ["en", "fr"]) {
		for (const path of paths) {
			await page.goto(new URL(`${path}?lang=${locale}`, origin).href);
			const heading = page.locator("main h1").first();
			const navigation = page.getByRole("navigation", {
				name: locale === "fr" ? "Pages de la section" : "Section pages",
				exact: true,
			});
			await expect(heading).toBeVisible();
			await expect(navigation).toBeVisible();
			await expect(navigation).toHaveCount(1);
			await expect(navigation.locator('a[aria-current="page"]')).toHaveCount(1);
			await expect
				.poll(async () => {
					const title = await heading.boundingBox();
					const tabs = await navigation.boundingBox();
					return Boolean(title && tabs && tabs.y >= title.y + title.height);
				})
				.toBe(true);
			if (path === "/paywalls") {
				const summary = page.locator("summary").filter({ hasText: /^(Library|Bibliothèque)$/u });
				const library = summary.locator("..");
				if (!(await library.evaluate((node) => node.open))) await summary.click();
				await expect
					.poll(async () => {
						const title = await summary.boundingBox();
						const content = await library.locator(":scope > summary + *").boundingBox();
						return title && content ? content.y - title.y - title.height : 0;
					})
					.toBeGreaterThanOrEqual(11);
			}
			console.log(`${locale}: ${path} — section navigation follows the title`);
		}
	}
} finally {
	await browser.close();
}
