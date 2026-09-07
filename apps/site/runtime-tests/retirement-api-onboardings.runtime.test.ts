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
const plugin = "supbrd-plugmod-onboardings";
const file = "retirement-api-onboardings.runtime.test.ts";
test("canonical Onboardings APIs publish a version, target an experiment, measure completion and preserve CRUD effects", async () => {
	const scope = await prepareApiPlugin(plugin);
	const base = `/api/v1/onboardings/projects/${scope.production_project_ref}`;
	const db = pluginDatabase("onboardings");
	const command = (id: string, method: string, path: string, body?: unknown) =>
		apiCommand(plugin, id, {
			method,
			path: `${base}${path}`,
			...(body === undefined ? {} : { body }),
		});
	const read = (id: string, path: string) =>
		apiRead(plugin, id, { method: "GET", path: `${base}${path}` });
	const definition = {
		screens: [
			{ id: "welcome", blocks: [{ id: "title", type: "heading", text: "Welcome to the proof" }] },
			{
				id: "finish",
				blocks: [{ id: "done", type: "button", text: "Continue", action: "complete" }],
			},
		],
		theme: { primary: "#635bff" },
	};
	const created = await jsonResult<{ data: { id: string } }>(
		await command("create_onboarding", "POST", "", {
			identifier: `proof-${crypto.randomUUID()}`,
			display_name: "Canonical onboarding",
			configuration: definition,
		}),
		201,
	);
	const id = created.data.id;
	const listed = await jsonResult<{ data: Array<{ id: string; display_name: string }> }>(
		await read("onboardings", ""),
	);
	expect(listed.data).toContainEqual(
		expect.objectContaining({ id, display_name: "Canonical onboarding" }),
	);
	proveApi(plugin, "create_onboarding", "mutation", file, [id]);
	proveApi(plugin, "onboardings", "read", file, [id]);
	await jsonResult(
		await command("update_onboarding", "PUT", `/${id}`, {
			display_name: "Updated onboarding",
			description: "Updated through canonical API",
		}),
	);
	expect(
		await db.prepare("SELECT display_name FROM onboardings WHERE id=?").bind(id).first(),
	).toEqual({ display_name: "Updated onboarding" });
	proveApi(plugin, "update_onboarding", "mutation", file, [id]);
	const version = await jsonResult<{ data: { id: string } }>(
		await command("create_onboarding_version", "POST", `/${id}/versions`, {
			configuration: definition,
		}),
		201,
	);
	await jsonResult(
		await command("publish_onboarding", "POST", `/${id}/publish`, { version_id: version.data.id }),
	);
	const versions = await jsonResult<{
		data: Array<{ id: string; state: string; configuration: unknown }>;
	}>(await read("onboarding_versions", `/${id}/versions`));
	expect(versions.data.find((row) => row.id === version.data.id)?.state).toBe("published");
	expect(JSON.stringify(versions.data)).toContain("Welcome to the proof");
	proveApi(plugin, "create_onboarding_version", "mutation", file, [version.data.id]);
	proveApi(plugin, "publish_onboarding", "mutation", file, [version.data.id]);
	proveApi(plugin, "onboarding_versions", "read", file, [version.data.id]);
	const key = `proof-${crypto.randomUUID()}`;
	const placement = await jsonResult<{ data: { id: string } }>(
		await command("save_onboarding_placement", "POST", "/placements", {
			key,
			name: "Proof placement",
			onboarding_id: id,
			active_version_id: version.data.id,
			priority: 100,
			active: true,
		}),
		201,
	);
	const placements = await jsonResult<{ data: Array<{ id: string; key: string }> }>(
		await read("onboarding_placements", "/placements"),
	);
	expect(placements.data).toContainEqual(expect.objectContaining({ id: placement.data.id, key }));
	proveApi(plugin, "save_onboarding_placement", "mutation", file, [placement.data.id]);
	proveApi(plugin, "onboarding_placements", "read", file, [placement.data.id]);
	const rule = await jsonResult<{ data: { id: string } }>(
		await command("create_onboarding_targeting_rule", "POST", "/targeting-rules", {
			placement_id: placement.data.id,
			name: "iOS only",
			priority: 10,
			conditions: { platform: "ios" },
			active: true,
		}),
		201,
	);
	const rules = await jsonResult<{ data: Array<{ id: string; name: string }> }>(
		await read("onboarding_targeting_rules", "/targeting-rules"),
	);
	expect(rules.data).toContainEqual(
		expect.objectContaining({ id: rule.data.id, name: "iOS only" }),
	);
	proveApi(plugin, "create_onboarding_targeting_rule", "mutation", file, [rule.data.id]);
	proveApi(plugin, "onboarding_targeting_rules", "read", file, [rule.data.id]);
	const experience = await jsonResult<{ data: { id: string } }>(
		await command("create_onboarding_experience", "POST", "/experiences", {
			placement_id: placement.data.id,
			name: "Welcome experiment",
			status: "draft",
			traffic_percentage: 10000,
			variants: [
				{ name: "A", weight: 5000, version_id: version.data.id },
				{ name: "B", weight: 5000, version_id: version.data.id },
			],
		}),
		201,
	);
	await jsonResult(
		await command(
			"set_onboarding_experience_status",
			"POST",
			`/experiences/${experience.data.id}/status`,
			{ status: "running" },
		),
	);
	const experiences = await jsonResult<{ data: Array<{ id: string; status: string }> }>(
		await read("onboarding_experiences", "/experiences"),
	);
	expect(experiences.data.find((row) => row.id === experience.data.id)?.status).toBe("running");
	proveApi(plugin, "create_onboarding_experience", "mutation", file, [experience.data.id]);
	proveApi(plugin, "set_onboarding_experience_status", "mutation", file, [experience.data.id]);
	proveApi(plugin, "onboarding_experiences", "read", file, [experience.data.id]);
	const resolve = async (platform: string) =>
		jsonResult<{ data: { version_id: string; variant_id: string } | null }>(
			await SELF.fetch(`https://site.example${base}/resolve`, {
				method: "POST",
				headers: { ...apiHeaders, "Idempotency-Key": crypto.randomUUID() },
				body: JSON.stringify({ placement: key, platform, anonymous_id: "proof-customer" }),
			}),
		);
	expect((await resolve("android")).data).toBeNull();
	const resolved = (await resolve("ios")).data!;
	expect(resolved.version_id).toBe(version.data.id);
	expect(resolved.variant_id).toBeTruthy();
	const events = ["impression", "step_view", "complete"].map((type) => ({
		id: crypto.randomUUID(),
		type,
		placement: key,
		platform: "ios",
		version_id: version.data.id,
		variant_id: resolved.variant_id,
		step_id: type === "step_view" ? "welcome" : undefined,
		occurred_at: new Date().toISOString(),
	}));
	const accepted = await SELF.fetch(`https://site.example${base}/events`, {
		method: "POST",
		headers: { ...apiHeaders, "Idempotency-Key": crypto.randomUUID() },
		body: JSON.stringify({ events }),
	});
	expect(accepted.status, await accepted.clone().text()).toBe(202);
	const statistics = await jsonResult<{
		data: { totals: Record<string, number>; completion_rate: number };
	}>(await read("onboarding_statistics", `/statistics?placement_id=${placement.data.id}`));
	expect(statistics.data).toMatchObject({
		totals: { impression: 1, step_view: 1, complete: 1 },
		completion_rate: 1,
	});
	proveApi(plugin, "onboarding_statistics", "read", file, [id]);
	await jsonResult(await command("delete_onboarding", "DELETE", `/${id}`));
	expect(await db.prepare("SELECT id FROM onboardings WHERE id=?").bind(id).first()).toBeNull();
	const deleted = await jsonResult<{ data: Array<{ id: string }> }>(await read("onboardings", ""));
	expect(deleted.data.some((row) => row.id === id)).toBe(false);
	proveApi(plugin, "delete_onboarding", "mutation", file, [id]);
});
