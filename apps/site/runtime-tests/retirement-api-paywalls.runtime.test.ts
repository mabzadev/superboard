import { SELF } from "cloudflare:test";
import { expect, test } from "vitest";

import {
	apiHeaders,
	apiCommand,
	apiRead,
	jsonResult,
	pluginDatabase,
	prepareApiPlugin,
	proveApi,
} from "./retirement-api-helpers.js";
const plugin = "supbrd-plugmod-paywalls";
const file = "retirement-api-paywalls.runtime.test.ts";
test("canonical Paywalls APIs preserve published designs, placements, experiments and measured events", async () => {
	const scope = await prepareApiPlugin(plugin);
	const base = `/api/v1/paywalls/projects/${scope.production_project_ref}`;
	const db = pluginDatabase("paywalls");
	const command = (id: string, method: string, path: string, body?: unknown) =>
		apiCommand(plugin, id, {
			method,
			path: `${base}${path}`,
			...(body === undefined ? {} : { body }),
		});
	const read = (id: string, path: string) =>
		apiRead(plugin, id, { method: "GET", path: `${base}${path}` });
	const identifier = `proof-${crypto.randomUUID()}`;
	const wall = await jsonResult<{ data: { id: string } }>(
		await command("create_paywall", "POST", "", { identifier, display_name: "Canonical premium" }),
		201,
	);
	const id = wall.data.id;
	const walls = await jsonResult<{
		data: Array<{ id: string; display_name?: string; name: string }>;
	}>(await read("paywalls", ""));
	expect(walls.data.some((row) => row.id === id)).toBe(true);
	expect(await db.prepare("SELECT name FROM paywalls WHERE id=?").bind(id).first()).toEqual({
		name: "Canonical premium",
	});
	proveApi(plugin, "create_paywall", "mutation", file, [id]);
	proveApi(plugin, "paywalls", "read", file, [id]);
	await jsonResult(
		await command("update_paywall", "PUT", `/paywalls/${id}`, {
			identifier,
			display_name: "Updated premium",
			description: "Persisted description",
		}),
	);
	expect(
		await db.prepare("SELECT name,description FROM paywalls WHERE id=?").bind(id).first(),
	).toEqual({ name: "Updated premium", description: "Persisted description" });
	proveApi(plugin, "update_paywall", "mutation", file, [id]);
	const versionIds: string[] = [];
	for (const text of ["Premium A", "Premium B"]) {
		const version = await jsonResult<{ data: { id: string } }>(
			await command("create_paywall_version", "POST", `/paywalls/${id}/versions`, {
				definition: {
					schema_version: 1,
					components: [{ id: "title", type: "heading", props: { text } }],
				},
			}),
			201,
		);
		versionIds.push(version.data.id);
		await jsonResult(
			await command(
				"publish_paywall_version",
				"POST",
				`/paywalls/${id}/versions/${version.data.id}/publish`,
				{},
			),
		);
	}
	const versions = await jsonResult<{
		data: Array<{ id: string; status: string; definition: unknown }>;
	}>(await read("paywall_versions", `/paywalls/${id}/versions`));
	for (const versionId of versionIds)
		expect(versions.data.find((row) => row.id === versionId)?.status).toBe("published");
	expect(JSON.stringify(versions.data)).toContain("Premium B");
	proveApi(plugin, "create_paywall_version", "mutation", file, versionIds);
	proveApi(plugin, "publish_paywall_version", "mutation", file, versionIds);
	proveApi(plugin, "paywall_versions", "read", file, versionIds);
	const key = `placement-${crypto.randomUUID()}`;
	const placementBody = {
		key,
		paywall_id: id,
		active_version_id: versionIds[0],
		priority: 100,
		active: true,
		targeting: {},
	};
	const placement = await jsonResult<{ data: { id: string } }>(
		await command("save_paywall_placement", "POST", "/placements", placementBody),
		201,
	);
	const placements = await jsonResult<{
		data: Array<{ id: string; key: string; paywall_id: string }>;
	}>(await read("paywall_placements", "/placements"));
	expect(placements.data).toContainEqual(
		expect.objectContaining({ id: placement.data.id, key, paywall_id: id }),
	);
	proveApi(plugin, "save_paywall_placement", "mutation", file, [placement.data.id]);
	proveApi(plugin, "paywall_placements", "read", file, [placement.data.id]);
	const experimentBody = {
		paywall_id: id,
		name: "Canonical experiment",
		status: "draft",
		traffic_percent: 100,
		variants: [
			{ key: "a", version_id: versionIds[0], weight: 50 },
			{ key: "b", version_id: versionIds[1], weight: 50 },
		],
	};
	const experience = await jsonResult<{ data: { id: string } }>(
		await command("create_paywall_experience", "POST", "/experiences", experimentBody),
		201,
	);
	expect(
		await db
			.prepare("SELECT name,status FROM experiences WHERE id=?")
			.bind(experience.data.id)
			.first(),
	).toEqual({ name: "Canonical experiment", status: "draft" });
	proveApi(plugin, "create_paywall_experience", "mutation", file, [experience.data.id]);
	await jsonResult(
		await command("update_paywall_experience", "PUT", `/experiences/${experience.data.id}`, {
			...experimentBody,
			status: "running",
		}),
	);
	const experiences = await jsonResult<{ data: Array<{ id: string; status: string }> }>(
		await read("paywall_experiences", "/experiences"),
	);
	expect(experiences.data.find((row) => row.id === experience.data.id)?.status).toBe("running");
	proveApi(plugin, "update_paywall_experience", "mutation", file, [experience.data.id]);
	proveApi(plugin, "paywall_experiences", "read", file, [experience.data.id]);
	await jsonResult(
		await command("save_paywall_placement", "PUT", `/placements/${placement.data.id}`, {
			...placementBody,
			experience_id: experience.data.id,
		}),
	);
	const resolve = await SELF.fetch(`https://site.example${base}/resolve`, {
		method: "POST",
		headers: { ...apiHeaders, "Idempotency-Key": crypto.randomUUID() },
		body: JSON.stringify({ placement: key, subject_id: "proof-subject", platform: "ios" }),
	});
	const resolved = await jsonResult<{
		data: { paywall_id: string; version_id: string; variant_id: string; experience_id: string };
	}>(resolve);
	expect(resolved.data.paywall_id).toBe(id);
	expect(versionIds).toContain(resolved.data.version_id);
	const event = await SELF.fetch(`https://site.example${base}/events`, {
		method: "POST",
		headers: { ...apiHeaders, "Idempotency-Key": crypto.randomUUID() },
		body: JSON.stringify({
			events: [
				{
					id: crypto.randomUUID(),
					type: "view",
					placement: key,
					paywall_id: id,
					version_id: resolved.data.version_id,
					experience_id: experience.data.id,
					variant_id: resolved.data.variant_id,
					platform: "ios",
					occurred_at: new Date().toISOString(),
				},
			],
		}),
	});
	expect(await jsonResult(event, 202)).toMatchObject({ data: { accepted: 1 } });
	const stats = await jsonResult<{ data: { totals: { view: number } } }>(
		await read("paywall_statistics", `/statistics?placement_id=${placement.data.id}`),
	);
	expect(stats.data.totals.view).toBe(1);
	proveApi(plugin, "paywall_statistics", "read", file, [id, placement.data.id]);
	await jsonResult(
		await command("archive_paywall_experience", "DELETE", `/experiences/${experience.data.id}`),
	);
	expect(
		await db.prepare("SELECT status FROM experiences WHERE id=?").bind(experience.data.id).first(),
	).toEqual({ status: "archived" });
	proveApi(plugin, "archive_paywall_experience", "mutation", file, [experience.data.id]);
	await jsonResult(await command("archive_paywall", "DELETE", `/paywalls/${id}`));
	expect(
		(
			await db
				.prepare("SELECT archived_at FROM paywalls WHERE id=?")
				.bind(id)
				.first<{ archived_at: string }>()
		)?.archived_at,
	).toBeTruthy();
	const archived = await jsonResult<{ data: Array<{ id: string }> }>(await read("paywalls", ""));
	expect(archived.data.some((row) => row.id === id)).toBe(false);
	proveApi(plugin, "archive_paywall", "mutation", file, [id]);
});
