import { SELF } from "cloudflare:test";
import { expect, test } from "vitest";

import { apiHeaders, jsonResult, prepareApiPlugin } from "./retirement-api-helpers.js";

test("operator usage exports provide an admitted local download and a public email URL", async () => {
	const scope = await prepareApiPlugin("supbrd-plug-settings");
	await prepareApiPlugin("supbrd-plug-user");
	const response = await SELF.fetch(
		`https://site.example/api/v1/instances/${scope.instance.id}/exports/usage`,
		{
			method: "POST",
			headers: { ...apiHeaders, "Idempotency-Key": crypto.randomUUID() },
			body: JSON.stringify({ start_date: "2026-01-01", end_date: "2026-12-31" }),
		},
	);
	const result = await jsonResult<{ download_path: string; url: string }>(response, 202);
	expect(result.download_path).toMatch(/^\/api\/v1\/projects\/exports\//);
	expect(new URL(result.url).origin).toBe("https://api.site.test");
	const download = await SELF.fetch(`https://site.example${result.download_path}`, {
		headers: apiHeaders,
	});
	expect(download.status).toBe(200);
	expect(download.headers.get("content-type")).toContain("text/csv");
	expect(await download.text()).toContain("date,active_users");
});
