import { test, expect } from "../fixtures/base-fixtures.js";
import {
	evidence,
	operatorHeaders,
	projectRef,
	ready,
	siteApi,
	unique,
	unwrap,
} from "../fixtures/site-api.js";

const nativeKey = /^og_app_/;

test("native App key provisions the SDK without a historical Front token", async ({
	authenticatedPage: page,
}) => {
	const project = await projectRef(page);
	const domain = "native-production-sdk.example.test";
	const setup = `/api/v1/app/projects/${project}/setup/web`;
	const previous = await siteApi(page.request, "supbrd-plug-settings", "GET", setup);
	try {
		await siteApi(page.request, "supbrd-plug-settings", "PUT", setup, {
			domain,
			minimum_version: "1.0.0",
			recommended_version: "1.0.0",
			maintenance_enabled: false,
		});
		await ready(page, "/app/access-key");
		await page.getByRole("button", { name: "Rotate Access Key", exact: true }).click();
		const created = page.waitForResponse(
			(response) =>
				response.request().method() === "POST" &&
				(response.url().includes("access-key/rotate") ||
					(response.request().postData() ?? "").includes("access-key/rotate")),
		);
		await page.getByRole("button", { name: "Rotate key", exact: true }).click();
		const rotated = await created;
		const key = unwrap(await rotated.json());
		await page.reload();
		expect(rotated.status()).toBeLessThan(300);
		expect(nativeKey.test(key.secret)).toBe(true);
		const sdkHeaders = {
			...operatorHeaders("supbrd-plug-user"),
			"PROJECT-KEY": key.secret,
			PLATFORM: "web",
			IDENTIFIER: domain,
			ENVIRONMENT: "production",
		};

		const runtime = await page.request.post("/api/v1/app/runtime-policy", {
			headers: sdkHeaders,
			data: { app_version: "1.0.0" },
		});
		expect(runtime.status()).toBe(200);
		expect(unwrap(await runtime.json())).toMatchObject({ status: "operational", platform: "web" });
		const invalid = await page.request.post("/api/v1/app/runtime-policy", {
			headers: {
				...sdkHeaders,
				"Idempotency-Key": unique("sdk-invalid"),
				IDENTIFIER: "wrong.example.test",
			},
			data: { app_version: "1.0.0" },
		});
		expect(invalid.status()).toBe(403);
		await ready(page, "/app/access-key");
		await expect(page.getByRole("heading", { name: "Access Key", exact: true })).toBeVisible();
		const keys = await siteApi(
			page.request,
			"supbrd-plug-user",
			"GET",
			`/api/v1/app/projects/${project}/access-key`,
		);
		expect(JSON.stringify(keys).includes(key.secret)).toBe(false);
		await evidence(
			"supbrd-plug-user",
			"superboard.app_access_key",
			[key.id],
			"Rotated a real App-owned key through the browser confirmation dialog, authenticated the actual SDK runtime-policy and rejected a different application identifier; the read API redacts the stored credential.",
		);
	} finally {
		if (previous?.configuration && previous.status !== "not_configured")
			await siteApi(page.request, "supbrd-plug-settings", "PUT", setup, previous.configuration);
		else await siteApi(page.request, "supbrd-plug-settings", "DELETE", setup);
	}
});
