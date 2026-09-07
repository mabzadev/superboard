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
const plugin = "supbrd-plugmod-dynamic-links";
const file = "retirement-api-dynamic-links.runtime.test.ts";
test("canonical Dynamic Links APIs persist campaigns, redirect behavior, tracking facts and operator-confirmed domain metadata", async () => {
	const scope = await prepareApiPlugin(plugin);
	const base = `/api/v1/dynamic-links/projects/${scope.production_project_ref}`;
	const db = pluginDatabase("dynamic-links");
	const command = (id: string, method: string, path: string, body?: unknown) =>
		apiCommand(plugin, id, {
			method,
			path: `${base}${path}`,
			...(body === undefined ? {} : { body }),
		});
	const read = (id: string, path: string) =>
		apiRead(plugin, id, { method: "GET", path: `${base}${path}` });
	const campaign = await jsonResult<{ data: { id: string } }>(
		await command("create_link_campaign", "POST", "/campaigns", {
			name: "Attribution proof",
			slug: `campaign-${crypto.randomUUID()}`,
			status: "active",
			metadata: { proof: true },
		}),
		201,
	);
	const campaigns = await jsonResult<{ data: Array<{ id: string; name: string }> }>(
		await read("link_campaigns", "/campaigns"),
	);
	expect(campaigns.data).toContainEqual(
		expect.objectContaining({ id: campaign.data.id, name: "Attribution proof" }),
	);
	proveApi(plugin, "create_link_campaign", "mutation", file, [campaign.data.id]);
	proveApi(plugin, "link_campaigns", "read", file, [campaign.data.id]);
	const slug = `link-${crypto.randomUUID()}`;
	const payload = {
		slug,
		name: "Attribution link",
		destination_url: "https://application.example/original",
		campaign_id: campaign.data.id,
		data: { proof: true },
		tags: ["retirement"],
		active: true,
	};
	const link = await jsonResult<{ data: { id: string } }>(
		await command("create_link", "POST", "/links", payload),
		201,
	);
	const id = link.data.id;
	const stored = await db
		.prepare("SELECT project_id,destination_url FROM links WHERE id=?")
		.bind(id)
		.first<{ project_id: string; destination_url: string }>();
	expect(stored?.destination_url).toBe(payload.destination_url);
	proveApi(plugin, "create_link", "mutation", file, [id]);
	const links = await jsonResult<{ data: Array<{ id: string; slug: string }> }>(
		await read("links", "/links"),
	);
	expect(links.data).toContainEqual(expect.objectContaining({ id, slug }));
	proveApi(plugin, "links", "read", file, [id]);
	await jsonResult(
		await command("update_link", "PUT", `/links/${id}`, {
			...payload,
			name: "Updated link",
			destination_url: "https://application.example/updated",
		}),
	);
	expect(
		await db.prepare("SELECT name,destination_url FROM links WHERE id=?").bind(id).first(),
	).toEqual({ name: "Updated link", destination_url: "https://application.example/updated" });
	proveApi(plugin, "update_link", "mutation", file, [id]);
	const resolve = () =>
		apiRead(plugin, "resolved_link", {
			method: "POST",
			path: `${base}/links/${slug}/resolve`,
			body: { platform: "ios" },
		});
	expect(await jsonResult(await resolve())).toMatchObject({
		data: { link_id: id, destination_url: "https://application.example/updated" },
	});
	proveApi(plugin, "resolved_link", "read", file, [id]);
	const rule = await jsonResult<{ data: { id: string } }>(
		await command("create_redirect_rule", "POST", "/redirect-rules", {
			name: "iOS redirect",
			priority: 1,
			rule: { platform: "ios", destination_url: "https://application.example/ios" },
			active: true,
		}),
		201,
	);
	expect(await jsonResult(await resolve())).toMatchObject({
		data: { destination_url: "https://application.example/ios" },
	});
	proveApi(plugin, "create_redirect_rule", "mutation", file, [rule.data.id]);
	const rules = await jsonResult<{ data: Array<{ id: string; name: string }> }>(
		await read("redirect_rules", "/redirect-rules"),
	);
	expect(rules.data).toContainEqual(
		expect.objectContaining({ id: rule.data.id, name: "iOS redirect" }),
	);
	proveApi(plugin, "redirect_rules", "read", file, [rule.data.id]);
	await jsonResult(
		await command("update_redirect_rule", "PUT", `/redirect-rules/${rule.data.id}`, {
			name: "Updated iOS rule",
			priority: 1,
			rule: { platform: "ios", destination_url: "https://application.example/ios-updated" },
			active: true,
		}),
	);
	expect(await jsonResult(await resolve())).toMatchObject({
		data: { destination_url: "https://application.example/ios-updated" },
	});
	proveApi(plugin, "update_redirect_rule", "mutation", file, [rule.data.id]);
	await jsonResult(
		await command("delete_redirect_rule", "DELETE", `/redirect-rules/${rule.data.id}`),
	);
	expect(
		await db.prepare("SELECT id FROM redirect_rules WHERE id=?").bind(rule.data.id).first(),
	).toBeNull();
	expect(await jsonResult(await resolve())).toMatchObject({
		data: { destination_url: "https://application.example/updated" },
	});
	proveApi(plugin, "delete_redirect_rule", "mutation", file, [rule.data.id]);
	const preview = {
		title: "Canonical preview",
		description: "Persisted preview",
		image_url: "https://static.example/preview.png",
		site_name: "Application",
	};
	await jsonResult(await command("save_social_preview", "PUT", "/social-preview", preview));
	expect(await jsonResult(await read("social_preview", "/social-preview"))).toMatchObject({
		data: preview,
	});
	expect(
		await db
			.prepare("SELECT title FROM social_previews WHERE project_id=?")
			.bind(stored!.project_id)
			.first(),
	).toEqual({ title: preview.title });
	proveApi(plugin, "save_social_preview", "mutation", file, [stored!.project_id]);
	proveApi(plugin, "social_preview", "read", file, [stored!.project_id]);
	const tracking = { enabled: true, provider: "opengrow", configuration: { proof: "recorded" } };
	await jsonResult(await command("save_tracking", "PUT", "/tracking", tracking));
	expect(await jsonResult(await read("tracking", "/tracking"))).toMatchObject({ data: tracking });
	expect(
		await db
			.prepare("SELECT provider FROM tracking_settings WHERE project_id=?")
			.bind(stored!.project_id)
			.first(),
	).toEqual({ provider: "opengrow" });
	proveApi(plugin, "save_tracking", "mutation", file, [stored!.project_id]);
	proveApi(plugin, "tracking", "read", file, [stored!.project_id]);
	const events = ["view", "open", "install"].map((type) => ({
		id: crypto.randomUUID(),
		type,
		link_id: id,
		campaign_id: campaign.data.id,
		platform: "ios",
		occurred_at: new Date().toISOString(),
	}));
	const ingested = await SELF.fetch(`https://site.example${base}/tracking/events`, {
		method: "POST",
		headers: { ...apiHeaders, "Idempotency-Key": crypto.randomUUID() },
		body: JSON.stringify({ events }),
	});
	expect(await jsonResult(ingested, 202)).toMatchObject({ data: { accepted: 3 } });
	const campaignStats = await jsonResult<{
		data: Array<{ id: string; total_views: number; total_opens: number; total_installs: number }>;
	}>(await read("link_campaign_analytics", "/campaign-analytics"));
	expect(campaignStats.data.find((row) => row.id === campaign.data.id)).toMatchObject({
		total_views: 1,
		total_opens: 1,
		total_installs: 1,
	});
	proveApi(plugin, "link_campaign_analytics", "read", file, [campaign.data.id]);
	const statistics = await jsonResult<{ data: { totals: Record<string, number> } }>(
		await read("link_statistics", "/statistics"),
	);
	expect(statistics.data.totals).toMatchObject({ views: 1, opens: 1, installs: 1 });
	proveApi(plugin, "link_statistics", "read", file, [id]);
	const domain = await jsonResult<{ data: { id: string; hostname: string } }>(
		await command("create_domain", "POST", "/domains", {
			hostname: "links.retirement.example",
			is_default: false,
		}),
		201,
	);
	expect(
		await db.prepare("SELECT hostname,status FROM domains WHERE id=?").bind(domain.data.id).first(),
	).toEqual({ hostname: "links.retirement.example", status: "pending" });
	proveApi(plugin, "create_domain", "mutation", file, [domain.data.id]);
	const domains = await jsonResult<{ data: Array<{ id: string; status: string }> }>(
		await read("domains", "/domains"),
	);
	expect(domains.data).toContainEqual(
		expect.objectContaining({ id: domain.data.id, status: "pending" }),
	);
	proveApi(plugin, "domains", "read", file, [domain.data.id]);
	await jsonResult(
		await command("verify_domain", "POST", `/domains/${domain.data.id}/verify`, { verified: true }),
	);
	const confirmed = await db
		.prepare("SELECT status,verified_at FROM domains WHERE id=?")
		.bind(domain.data.id)
		.first<{ status: string; verified_at: string }>();
	expect(confirmed?.status).toBe("verified");
	expect(confirmed?.verified_at).toBeTruthy();
	proveApi(plugin, "verify_domain", "mutation", file, [domain.data.id]);
	await jsonResult(await command("delete_domain", "DELETE", `/domains/${domain.data.id}`));
	expect(
		await db.prepare("SELECT id FROM domains WHERE id=?").bind(domain.data.id).first(),
	).toBeNull();
	proveApi(plugin, "delete_domain", "mutation", file, [domain.data.id]);
	await jsonResult(await command("delete_link", "DELETE", `/links/${id}`));
	expect(await db.prepare("SELECT id FROM links WHERE id=?").bind(id).first()).toBeNull();
	proveApi(plugin, "delete_link", "mutation", file, [id]);
	await jsonResult(
		await command("delete_link_campaign", "DELETE", `/campaigns/${campaign.data.id}`),
	);
	expect(
		await db.prepare("SELECT id FROM campaigns WHERE id=?").bind(campaign.data.id).first(),
	).toBeNull();
	proveApi(plugin, "delete_link_campaign", "mutation", file, [campaign.data.id]);
});
