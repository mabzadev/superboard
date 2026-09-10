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
const plugin = "supbrd-plugmod-support";
const file = "retirement-api-support.runtime.test.ts";
test("canonical Support APIs persist settings, credentials, real conversation messages and published knowledge", async () => {
	const scope = await prepareApiPlugin(plugin);
	const base = `/api/v1/support/projects/${scope.production_project_ref}`;
	const db = pluginDatabase("support");
	const command = (id: string, method: string, path: string, body?: unknown) =>
		apiCommand(plugin, id, {
			method,
			path: `${base}${path}`,
			...(body === undefined ? {} : { body }),
		});
	const read = async <T>(id: string, path: string): Promise<T> =>
		(
			await jsonResult<{ data: T }>(
				await apiRead(plugin, id, { method: "GET", path: `${base}${path}` }),
			)
		).data;
	const fixture = async <T>(path: string, body: unknown, status = 201) =>
		(
			await jsonResult<{ data: T }>(
				await SELF.fetch(`https://site.example${base}${path}`, {
					method: "POST",
					headers: { ...apiHeaders, "Idempotency-Key": crypto.randomUUID() },
					body: JSON.stringify(body),
				}),
				status,
			)
		).data;
	await jsonResult(
		await command("update_support_settings", "PATCH", "/settings", {
			business_name: "Swiss Support",
			locale: "fr",
			timezone: "Europe/Zurich",
			features: { inbox: true },
		}),
	);
	let settings = await read<{
		settings: Record<string, unknown>;
		entities: Array<Record<string, unknown>>;
	}>("support_settings", "/settings");
	expect(settings.settings).toMatchObject({
		business_name: "Swiss Support",
		locale: "fr",
		timezone: "Europe/Zurich",
	});
	proveApi(plugin, "update_support_settings", "mutation", file, [scope.production_project_ref]);
	proveApi(plugin, "support_settings", "read", file, [scope.production_project_ref]);
	const configBody = {
		entity_type: "webhook",
		name: "Proof webhook",
		enabled: false,
		configuration: { url: "https://hooks.example.test/support", events: ["conversation.created"] },
	};
	const entity = (
		await jsonResult<{ data: { id: string } }>(
			await command("create_support_configuration", "POST", "/settings/entities", configBody),
			201,
		)
	).data;
	expect(
		await db
			.prepare("SELECT name FROM support_configuration_entities WHERE id=?")
			.bind(entity.id)
			.first(),
	).toEqual({ name: "Proof webhook" });
	proveApi(plugin, "create_support_configuration", "mutation", file, [entity.id]);
	await jsonResult(
		await command("update_support_configuration", "PATCH", `/settings/entities/${entity.id}`, {
			...configBody,
			name: "Updated webhook",
		}),
	);
	settings = await read("support_settings", "/settings");
	expect(settings.entities).toContainEqual(
		expect.objectContaining({ id: entity.id, name: "Updated webhook" }),
	);
	proveApi(plugin, "update_support_configuration", "mutation", file, [entity.id]);
	const key = crypto.randomUUID();
	await jsonResult(
		await command(
			"rotate_support_webhook_secret",
			"PUT",
			`/settings/entities/${entity.id}/secret`,
			{ secret: key },
		),
	);
	const secret = await db
		.prepare(
			"SELECT encrypted_secret,secret_version FROM support_webhook_secrets WHERE webhook_id=?",
		)
		.bind(entity.id)
		.first<{ encrypted_secret: string; secret_version: number }>();
	expect(secret?.secret_version).toBe(1);
	expect(secret?.encrypted_secret.includes(key)).toBe(false);
	proveApi(plugin, "rotate_support_webhook_secret", "mutation", file, [entity.id]);
	expect(
		(
			await command(
				"revoke_support_webhook_secret",
				"DELETE",
				`/settings/entities/${entity.id}/secret`,
			)
		).status,
	).toBe(204);
	expect(
		await db
			.prepare("SELECT webhook_id FROM support_webhook_secrets WHERE webhook_id=?")
			.bind(entity.id)
			.first(),
	).toBeNull();
	proveApi(plugin, "revoke_support_webhook_secret", "mutation", file, [entity.id]);
	const inbox = await fixture<{ id: string }>("/workforce/inboxes", {
		name: "Proof Inbox",
		identifier: `proof-${crypto.randomUUID()}`,
		channel_type: "widget",
		status: "active",
	});
	const provider = (
		await jsonResult<{ data: { id: string } }>(
			await command("create_support_provider", "POST", "/providers", {
				inbox_id: inbox.id,
				provider: "widget",
				display_name: "Proof provider",
			}),
			201,
		)
	).data;
	expect(
		await db
			.prepare("SELECT inbox_id FROM support_provider_endpoints WHERE id=?")
			.bind(provider.id)
			.first(),
	).toEqual({ inbox_id: inbox.id });
	proveApi(plugin, "create_support_provider", "mutation", file, [provider.id]);
	await jsonResult(
		await command("update_support_provider", "PATCH", `/providers/${provider.id}`, {
			display_name: "Updated provider",
		}),
	);
	const providers = await read<Array<Record<string, unknown>>>("support_providers", "/providers");
	expect(providers).toContainEqual(
		expect.objectContaining({ id: provider.id, display_name: "Updated provider" }),
	);
	proveApi(plugin, "update_support_provider", "mutation", file, [provider.id]);
	proveApi(plugin, "support_providers", "read", file, [provider.id]);
	const channels = await read<Array<Record<string, unknown>>>("support_channels", "/channels");
	expect(channels).toContainEqual(
		expect.objectContaining({ id: inbox.id, endpoint_id: provider.id, channel_type: "widget" }),
	);
	proveApi(plugin, "support_channels", "read", file, [inbox.id, provider.id]);
	const integration = (
		await jsonResult<{ data: { id: string } }>(
			await command("create_support_integration", "POST", "/integrations", {
				provider: "webhook",
				display_name: "Proof integration",
				settings: { url: "https://hooks.example.test/disabled" },
			}),
			201,
		)
	).data;
	expect(
		await db
			.prepare("SELECT display_name FROM support_integrations WHERE id=?")
			.bind(integration.id)
			.first(),
	).toEqual({ display_name: "Proof integration" });
	proveApi(plugin, "create_support_integration", "mutation", file, [integration.id]);
	await jsonResult(
		await command("update_support_integration", "PATCH", `/integrations/${integration.id}`, {
			display_name: "Updated integration",
			status: "disabled",
		}),
	);
	const integrations = await read<Array<Record<string, unknown>>>(
		"support_integrations",
		"/integrations",
	);
	expect(integrations).toContainEqual(
		expect.objectContaining({
			id: integration.id,
			display_name: "Updated integration",
			status: "disabled",
		}),
	);
	proveApi(plugin, "update_support_integration", "mutation", file, [integration.id]);
	proveApi(plugin, "support_integrations", "read", file, [integration.id]);
	const conversation = await fixture<{ id: string }>("/conversations", {
		external_user_id: `proof-${crypto.randomUUID()}`,
		client_conversation_id: crypto.randomUUID(),
		inbox_id: inbox.id,
		subject: "Proof conversation",
	});
	const sent = await jsonResult<{ data: { id: string } }>(
		await command("send_inbox_message", "POST", `/conversations/${conversation.id}/messages`, {
			client_message_id: crypto.randomUUID(),
			body: "Persisted reply from operator",
		}),
		201,
	);
	const messages = await read<Array<Record<string, unknown>>>(
		"inbox_messages",
		`/conversations/${conversation.id}/messages`,
	);
	expect(messages).toContainEqual(
		expect.objectContaining({ body: "Persisted reply from operator", sender_kind: "agent" }),
	);
	const messageIds = messages.map((row) => String(row.id));
	expect(messageIds).toContain(sent.data.id);
	proveApi(plugin, "send_inbox_message", "mutation", file, messageIds);
	proveApi(plugin, "inbox_messages", "read", file, messageIds);
	await jsonResult(
		await command("update_inbox_conversation", "PATCH", `/conversations/${conversation.id}`, {
			status: "pending",
			priority: "urgent",
		}),
	);
	const conversations = await read<Array<Record<string, unknown>>>(
		"inbox_conversations",
		"/conversations",
	);
	expect(conversations).toContainEqual(
		expect.objectContaining({
			id: conversation.id,
			status: "pending",
			priority: "urgent",
			message_count: 1,
		}),
	);
	proveApi(plugin, "update_inbox_conversation", "mutation", file, [conversation.id]);
	proveApi(plugin, "inbox_conversations", "read", file, [conversation.id]);
	const items = await read<Array<Record<string, unknown>>>("unified_inbox_items", "/items");
	expect(items).toContainEqual(
		expect.objectContaining({
			source_id: conversation.id,
			title: "Proof conversation",
			preview: "Persisted reply from operator",
			status: "pending",
		}),
	);
	proveApi(plugin, "unified_inbox_items", "read", file, [conversation.id]);
	const portal = await fixture<{ id: string }>("/help-center/portals", {
		name: "Proof portal",
		slug: `proof-${crypto.randomUUID()}`,
		locale: "fr",
	});
	const category = await fixture<{ id: string }>("/help-center/categories", {
		portal_id: portal.id,
		name: "Proof category",
		slug: "getting-started",
	});
	const folder = await fixture<{ id: string }>("/help-center/folders", {
		portal_id: portal.id,
		category_id: category.id,
		name: "Proof folder",
		slug: "guides",
	});
	const article = await fixture<{ id: string }>("/help-center/articles", {
		portal_id: portal.id,
		category_id: category.id,
		folder_id: folder.id,
		title: "Proof article",
		slug: "first-steps",
		content: "Persisted published instructions",
		status: "draft",
	});
	expect(
		await db.prepare("SELECT author_id FROM support_articles WHERE id=?").bind(article.id).first(),
	).toEqual({ author_id: "operator-1" });
	await jsonResult(
		await command("publish_support_article", "POST", `/help-center/articles/${article.id}/publish`),
	);
	expect(
		await db.prepare("SELECT status FROM support_articles WHERE id=?").bind(article.id).first(),
	).toEqual({ status: "published" });
	proveApi(plugin, "publish_support_article", "mutation", file, [article.id]);
	for (const [id, path, expected] of [
		["support_portals", "/help-center/portals", { id: portal.id, name: "Proof portal" }],
		["support_categories", "/help-center/categories", { id: category.id, portal_id: portal.id }],
		["support_folders", "/help-center/folders", { id: folder.id, category_id: category.id }],
		[
			"support_articles",
			"/help-center/articles",
			{ id: article.id, status: "published", content: "Persisted published instructions" },
		],
	] as const) {
		const rows = await read<Array<Record<string, unknown>>>(id, path);
		expect(rows).toContainEqual(expect.objectContaining(expected));
		proveApi(plugin, id, "read", file, [expected.id]);
	}
	const task = await fixture<{ id: string }>(
		"/captain/tasks",
		{ task_type: "summarize", conversation_id: conversation.id, input: {} },
		202,
	);
	const tasks = await read<Array<Record<string, unknown>>>(
		"support_assistant_tasks",
		"/captain/tasks",
	);
	expect(tasks).toContainEqual(
		expect.objectContaining({ id: task.id, task_type: "summarize", status: "queued" }),
	);
	proveApi(plugin, "support_assistant_tasks", "read", file, [task.id]);
	for (const [id, path, table, resourceId] of [
		[
			"delete_support_provider",
			`/providers/${provider.id}`,
			"support_provider_endpoints",
			provider.id,
		],
		[
			"delete_support_integration",
			`/integrations/${integration.id}`,
			"support_integrations",
			integration.id,
		],
		[
			"delete_support_configuration",
			`/settings/entities/${entity.id}`,
			"support_configuration_entities",
			entity.id,
		],
	] as const) {
		expect((await command(id, "DELETE", path)).status).toBe(
			id === "delete_support_configuration" ? 204 : 200,
		);
		expect(
			await db.prepare(`SELECT id FROM ${table} WHERE id=?`).bind(resourceId).first(),
		).toBeNull();
		proveApi(plugin, id, "mutation", file, [resourceId]);
	}
});
