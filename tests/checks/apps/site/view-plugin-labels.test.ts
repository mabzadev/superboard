import { expect, test } from "vitest";

import { withViewPluginLabels } from "../../../../apps/site/src/lib/view-plugin-labels.js";
import { pluginPackages } from "../../../../packages/contracts/src/plugin-packages.js";

function manifestResponse(
	plugins: Record<string, unknown> = {
		"supbrd-plug-journeys": { enabled: true },
		"supbrd-plug-commerce": { enabled: true },
		"supbrd-plug-data": { enabled: true },
	},
) {
	return Response.json({
		data: {
			collections: {
				views: {
					listColumns: ["plugin_id"],
					fields: {
						plugin_id: { kind: "string", label: "Plugin", required: true },
						name: { kind: "string", label: "Name" },
					},
				},
			},
			plugins,
		},
	});
}

test("Views offer one editable choice for each installed plugin", async () => {
	const response = await withViewPluginLabels(manifestResponse(), "en");
	const body = await response.json();
	const field = body.data.collections.views.fields.plugin_id;
	expect(field.kind).toBe("select");
	expect(field.readOnly).toBe(false);
	expect(field.options).toEqual([
		{ value: "superboard-acquisition", label: "Acquisition" },
		{ value: "superboard-monetization", label: "Monetization" },
		{ value: "superboard-data", label: "Data" },
	]);
	expect(body.data.collections.views.fields.name).toEqual({ kind: "string", label: "Name" });
	expect(field.required).toBe(true);
	expect(response.headers.get("Cache-Control")).toBe("private, no-store");
});

test("Views read renamed and localized labels from the current catalogue on each request", async () => {
	const owner = pluginPackages.find((item) => item.directory === "superboard-acquisition")!;
	const previous = { label: owner.label, label_fr: owner.label_fr };
	try {
		owner.label = "New acquisition name";
		owner.label_fr = "Nouveau nom acquisition";
		for (const locale of ["en", "fr"]) {
			const response = await withViewPluginLabels(manifestResponse(), locale);
			const body = await response.json();
			expect(body.data.collections.views.fields.plugin_id.options).toContainEqual({
				value: "superboard-acquisition",
				label: locale === "fr" ? owner.label_fr : owner.label,
			});
		}
	} finally {
		Object.assign(owner, previous);
	}
});

test("the choice list follows plugin installation and activation without duplicate aliases", async () => {
	const response = await withViewPluginLabels(
		manifestResponse({
			"supbrd-plug-journeys": { enabled: true },
			"supbrd-plugmod-flows": { enabled: true },
			"supbrd-plug-support": { enabled: false },
			"cloudflare-email": { enabled: true },
		}),
		"en",
	);
	expect((await response.json()).data.collections.views.fields.plugin_id.options).toEqual([
		{ value: "superboard-acquisition", label: "Acquisition" },
	]);
	const changed = await withViewPluginLabels(
		manifestResponse({ "supbrd-plug-support": { enabled: true } }),
		"en",
	);
	expect((await changed.json()).data.collections.views.fields.plugin_id.options).toEqual([
		{ value: "superboard-support", label: "Support" },
	]);
});

test("unrelated manifests and API failures pass through unchanged", async () => {
	for (const response of [
		Response.json({ data: { collections: {} } }),
		new Response(null, { status: 403 }),
	]) {
		expect(await withViewPluginLabels(response, "en")).toBe(response);
	}
});
