import { appendFileSync, readFileSync } from "node:fs";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";

import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { z } from "zod";

const catalog = z
	.object({
		adapters: z.array(
			z.object({
				plugin_id: z.string(),
				id: z.string(),
				kind: z.enum(["command", "data_source"]),
				operations: z.array(z.object({ method: z.string(), path: z.string() })),
			}),
		),
	})
	.parse(
		JSON.parse(
			readFileSync(
				new URL("../../../scripts/config/superboard-plugin-api-adapters.json", import.meta.url),
				"utf8",
			),
		),
	);
export const siteUrl = () => String(test.info().project.use.baseURL);
export const unique = (prefix: string) =>
	`${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
export function operatorHeaders(pluginId?: string) {
	return {
		Origin: siteUrl(),
		"X-EmDash-Request": "1",
		"Idempotency-Key": crypto.randomUUID(),
		...(pluginId ? { "X-SuperBoard-Plugin-Id": pluginId } : {}),
	};
}
export function unwrap(value: any): any {
	if (value && typeof value === "object" && "data" in value) {
		const inner = value.data;
		return inner && typeof inner === "object" && "data" in inner ? inner.data : inner;
	}
	return value;
}
export async function siteApi(
	request: APIRequestContext,
	pluginId: string,
	method: string,
	path: string,
	body?: unknown,
) {
	const pathname = new URL(path, siteUrl()).pathname;
	const adapter = catalog.adapters.find(
		(entry) =>
			entry.plugin_id === pluginId &&
			entry.operations.some(
				(operation) =>
					operation.method === method &&
					new RegExp(`^${operation.path.replace(/:[^/]+/g, "[^/]+").replace(/\*/g, ".*")}$`).test(
						pathname,
					),
			),
	);
	let target = path;
	let transportMethod = method;
	let data = body;
	if (adapter) {
		const envelope = { method, path, ...(body === undefined ? {} : { body }) };
		target = `/_emdash/api/superboard/plugins/${pluginId}/${adapter.kind === "command" ? "commands" : "data-sources"}/${adapter.id}`;
		if (adapter.kind === "data_source" && method === "GET")
			target += `?request=${encodeURIComponent(JSON.stringify(envelope))}`;
		else {
			transportMethod = "POST";
			data = envelope;
		}
	}
	const response = await request.fetch(target, {
		method: transportMethod,
		headers: operatorHeaders(pluginId),
		...(data === undefined ? {} : { data }),
	});
	if (!response.ok()) {
		const detail = await response.json().catch(() => ({}));
		throw new Error(
			`${method} ${pathname} failed (${response.status()}): ${detail.error?.code ?? detail.code ?? "request_failed"}: ${detail.error?.message ?? detail.message ?? ""}`,
		);
	}
	return unwrap(await response.json());
}
export async function projectRef(page: Page): Promise<string> {
	const response = await page.request.post("/_emdash/api/superboard/operator-context", {
		headers: operatorHeaders(),
		data: {},
	});
	expect(response.ok()).toBe(true);
	const scope = unwrap(await response.json());
	const project = scope.production_project_ref ?? scope.project_scope?.production_project_ref;
	if (typeof project !== "string") throw new Error("Production project reference missing");
	return project;
}
export async function ready(page: Page, path: string) {
	await page.goto(path);
	await page.waitForLoadState("networkidle");
	await expect(page.locator("main")).toBeVisible();
}
export async function evidence(
	pluginId: string,
	routeId: string,
	dataIds: string[],
	description: string,
) {
	const record = {
		plugin_id: pluginId,
		route_id: routeId,
		scenario: "functional",
		status: "passed",
		type: "browser",
		data_ids: dataIds,
		description,
		source_test: relative(
			fileURLToPath(new URL("../../../", import.meta.url)),
			test.info().file,
		),
		captured_at: new Date().toISOString(),
	};
	appendFileSync(
		process.env.SUPERBOARD_E2E_EVIDENCE ?? "/tmp/superboard-retirement-e2e-evidence.jsonl",
		JSON.stringify(record) + "\n",
	);
	await test.info().attach("functional-evidence", {
		contentType: "application/json",
		body: JSON.stringify(record),
	});
}

export function field(page: Page, label: string) {
	return page
		.locator("label")
		.filter({ hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) })
		.filter({ hasNot: page.locator("label") })
		.locator("..")
		.locator("input, textarea, select")
		.first();
}
export async function savedByClick(page: Page, label: string, pluginId: string) {
	const response = page.waitForResponse(
		(item) =>
			["POST", "PUT", "PATCH"].includes(item.request().method()) &&
			(item.url().includes(`/plugins/${pluginId}/commands/`) ||
				(item.url().includes("/api/v1/") &&
					item.request().headers()["x-superboard-plugin-id"] === pluginId)),
	);
	await page.getByRole("button", { name: label, exact: true }).click();
	const saved = await response;
	if (!saved.ok()) throw new Error(`Saving ${label} failed (${saved.status()})`);
	const value = unwrap(await saved.json());
	const id = value.id ?? value.item?.id ?? value.contact?.id ?? value.data?.id;
	if (typeof id !== "string" && typeof id !== "number")
		throw new Error(`Persisted identifier missing after ${label}`);
	return String(id);
}
