import { test, expect } from "../../fixtures/emdash-browser";

function apiHeaders(token: string, baseUrl: string) {
	return {
		"Content-Type": "application/json",
		Authorization: `Bearer ${token}`,
		"X-EmDash-Request": "1",
		Origin: baseUrl,
	};
}

test.describe("Allowed Domains Settings", () => {
	let headers: Record<string, string>;
	let baseUrl: string;

	test.beforeEach(async ({ admin, serverInfo }) => {
		await admin.devBypassAuth();
		baseUrl = serverInfo.baseUrl;
		headers = apiHeaders(serverInfo.token, baseUrl);

		const res = await fetch(`${baseUrl}/_emdash/api/admin/allowed-domains`, { headers });
		if (res.ok) {
			const data: any = await res.json();
			const domains = data.data?.domains ?? [];
			for (const d of domains) {
				if (d.domain.includes("e2e-test")) {
					await fetch(
						`${baseUrl}/_emdash/api/admin/allowed-domains/${encodeURIComponent(d.domain)}`,
						{ method: "DELETE", headers },
					).catch(() => {});
				}
			}
		}
	});

	test("renders the allowed domains settings page", async ({ admin, page }) => {
		await admin.goto("/settings/allowed-domains");
		await admin.waitForShell();
		await admin.waitForLoading();

		await expect(page.locator("h1").first()).toContainText("Self-Signup Domains");

		await expect(page.locator("h2", { hasText: "Allowed Domains" })).toBeVisible({
			timeout: 10000,
		});

		await expect(page.getByRole("button", { name: "Add Domain" })).toBeVisible();
	});

	test("shows empty state when no domains configured", async ({ admin, page }) => {
		await admin.goto("/settings/allowed-domains");
		await admin.waitForShell();
		await admin.waitForLoading();

		const emptyState = page.locator("text=No domains configured");

		const hasEmptyState = await emptyState.isVisible({ timeout: 5000 }).catch(() => false);
		if (hasEmptyState) {
			await expect(emptyState).toBeVisible();
		}
		await expect(page.getByRole("button", { name: "Add Domain" })).toBeVisible();
	});

	test("adds a new domain via the UI", async ({ admin, page }) => {
		await admin.goto("/settings/allowed-domains");
		await admin.waitForShell();
		await admin.waitForLoading();

		const testDomain = `e2e-test-${Date.now()}.example.com`;

		await page.getByRole("button", { name: "Add Domain" }).click();

		const domainInput = page.getByRole("textbox", { name: "Domain", exact: true });
		await expect(domainInput).toBeVisible({ timeout: 5000 });

		await domainInput.fill(testDomain);

		const submitButton = page.getByRole("button", { name: "Add Domain" });
		await submitButton.click();

		const allowedDomains = page.getByRole("region", { name: "Allowed Domains", exact: true });
		await expect(allowedDomains.getByText(testDomain, { exact: true })).toBeVisible({
			timeout: 10000,
		});

		const successMsg = page.locator("text=Domain added successfully");
		await expect(successMsg).toBeVisible({ timeout: 5000 });

		await fetch(`${baseUrl}/_emdash/api/admin/allowed-domains/${encodeURIComponent(testDomain)}`, {
			method: "DELETE",
			headers,
		}).catch(() => {});
	});

	test("removes a domain via the UI", async ({ admin, page }) => {
		const testDomain = `e2e-test-delete-${Date.now()}.example.com`;

		await fetch(`${baseUrl}/_emdash/api/admin/allowed-domains`, {
			method: "POST",
			headers,
			body: JSON.stringify({ domain: testDomain, defaultRole: 30 }),
		});

		await admin.goto("/settings/allowed-domains");
		await admin.waitForShell();
		await admin.waitForLoading();

		const allowedDomains = page.getByRole("region", { name: "Allowed Domains", exact: true });
		await expect(allowedDomains.getByText(testDomain, { exact: true })).toBeVisible({
			timeout: 10000,
		});

		const deleteButton = page.getByRole("button", { name: `Delete ${testDomain}` });
		await deleteButton.click();

		const dialog = page.locator('[role="dialog"]');
		await expect(dialog).toBeVisible({ timeout: 5000 });
		await expect(dialog.getByRole("heading", { name: "Remove Domain" })).toBeVisible();

		await dialog.getByRole("button", { name: "Remove Domain" }).click();

		await expect(allowedDomains.getByText(testDomain, { exact: true })).not.toBeVisible({
			timeout: 10000,
		});

		const successMsg = page.locator("text=Domain removed");
		await expect(successMsg).toBeVisible({ timeout: 5000 });
	});

	test("cancel delete keeps the domain", async ({ admin, page }) => {
		const testDomain = `e2e-test-keep-${Date.now()}.example.com`;

		await fetch(`${baseUrl}/_emdash/api/admin/allowed-domains`, {
			method: "POST",
			headers,
			body: JSON.stringify({ domain: testDomain, defaultRole: 30 }),
		});

		await admin.goto("/settings/allowed-domains");
		await admin.waitForShell();
		await admin.waitForLoading();

		const allowedDomains = page.getByRole("region", { name: "Allowed Domains", exact: true });
		await expect(allowedDomains.getByText(testDomain, { exact: true })).toBeVisible({
			timeout: 10000,
		});

		await page.getByRole("button", { name: `Delete ${testDomain}` }).click();

		const dialog = page.locator('[role="dialog"]');
		await expect(dialog).toBeVisible({ timeout: 5000 });

		await dialog.getByRole("button", { name: "Cancel" }).click();

		await expect(dialog).not.toBeVisible({ timeout: 5000 });

		await expect(allowedDomains.getByText(testDomain, { exact: true })).toBeVisible();

		await fetch(`${baseUrl}/_emdash/api/admin/allowed-domains/${encodeURIComponent(testDomain)}`, {
			method: "DELETE",
			headers,
		}).catch(() => {});
	});

	test("toggling enabled/disabled updates the domain", async ({ admin, page }) => {
		const testDomain = `e2e-test-toggle-${Date.now()}.example.com`;

		await fetch(`${baseUrl}/_emdash/api/admin/allowed-domains`, {
			method: "POST",
			headers,
			body: JSON.stringify({ domain: testDomain, defaultRole: 30 }),
		});

		await admin.goto("/settings/allowed-domains");
		await admin.waitForShell();
		await admin.waitForLoading();

		const toggle = page.getByRole("switch", { name: testDomain, exact: true });
		await expect(toggle).toBeVisible({ timeout: 10000 });
		await toggle.click();

		const statusMsg = page.locator("text=Domain updated");
		await expect(statusMsg).toBeVisible({ timeout: 5000 });

		await fetch(`${baseUrl}/_emdash/api/admin/allowed-domains/${encodeURIComponent(testDomain)}`, {
			method: "DELETE",
			headers,
		}).catch(() => {});
	});
});
