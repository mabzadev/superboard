import { env, SELF } from "cloudflare:test";
import { afterAll, expect } from "vitest";
const evidenceWrites: Promise<unknown>[] = [];
afterAll(async () => {
	await Promise.all(evidenceWrites);
});
import adapters from "../../../config/superboard-plugin-api-adapters.json";
import baseline from "../../../config/superboard-plugin-independence-baseline.json";
import { initializeOperatorProjectScope } from "../src/lib/operator-project-scope.js";

export const apiHeaders = {
	Origin: "https://site.example",
	"X-EmDash-Request": "1",
	"X-Parity-Operator": "1",
	"Content-Type": "application/json",
};
export async function prepareApiPlugin(pluginId: string) {
	const scope = await initializeOperatorProjectScope(
		env,
		{ id: "operator-1", role: 50 },
		crypto.randomUUID(),
	);
	const enabled = await SELF.fetch(
		`https://site.example/_emdash/api/superboard/plugins/${pluginId}/enable`,
		{ method: "POST", headers: { ...apiHeaders, "Idempotency-Key": crypto.randomUUID() } },
	);
	expect([200, 201], await enabled.clone().text()).toContain(enabled.status);
	return scope;
}
export type ApiOperation = { method: string; path: string; body?: unknown };
export async function apiCommand(
	pluginId: string,
	id: string,
	operation: ApiOperation,
	key = crypto.randomUUID(),
) {
	return SELF.fetch(
		`https://site.example/_emdash/api/superboard/plugins/${pluginId}/commands/${pluginId}.command.${id}`,
		{
			method: "POST",
			headers: { ...apiHeaders, "Idempotency-Key": key },
			body: JSON.stringify(operation),
		},
	);
}
export async function apiRead(pluginId: string, id: string, operation: ApiOperation) {
	const url = new URL(
		`https://site.example/_emdash/api/superboard/plugins/${pluginId}/data-sources/${pluginId}.data_source.${id}`,
	);
	if (operation.method !== "GET")
		return SELF.fetch(url, {
			method: "POST",
			headers: { ...apiHeaders, "Idempotency-Key": crypto.randomUUID() },
			body: JSON.stringify(operation),
		});
	url.searchParams.set("request", JSON.stringify(operation));
	return SELF.fetch(url, { headers: apiHeaders });
}
export async function jsonResult<T>(response: Response, status = 200): Promise<T> {
	expect(response.status, await response.clone().text()).toBe(status);
	return response.json<T>();
}
export function proveApi(
	pluginId: string,
	id: string,
	scenario: "read" | "mutation",
	testFile: string,
	dataIds: string[] = [],
) {
	const kind = scenario === "mutation" ? "command" : "data_source";
	const routeId =
		id === "health" ? `gateway.${pluginId}.health` : `gateway.${pluginId}.${kind}.${id}`;
	const route = baseline.plugins
		.find((plugin) => plugin.plugin_id === pluginId)
		?.api.find((api) => api.route_id === routeId);
	expect(
		route ?? adapters.additional_contributions.find((item) => `gateway.${item.id}` === routeId),
		routeId,
	).toBeDefined();
	if (scenario === "mutation") expect(dataIds.filter(Boolean).length).toBeGreaterThan(0);
	const proof = {
		plugin_id: pluginId,
		route_id: routeId,
		scenario,
		status: "passed",
		type: "integration",
		evidence_path: `docs/evidence/plugin-autonomy/${testFile.replace(".runtime.test.ts", "")}.txt`,
		test: `apps/site/runtime-tests/${testFile}`,
		...(dataIds.length ? { data_ids: dataIds } : {}),
	};
	const recorder: unknown = Reflect.get(env, "TEST_API_EVIDENCE_RECORDER");
	if (!isEvidenceRecorder(recorder)) throw new Error("Missing real evidence recorder binding");
	evidenceWrites.push(
		recorder
			.fetch(
				new Request("https://test-evidence.internal", {
					method: "POST",
					body: JSON.stringify(proof),
				}),
			)
			.then((response) => {
				expect(response.status).toBe(200);
				return undefined;
			}),
	);
}
export function pluginDatabase(name: string): D1Database {
	const binding: unknown = Reflect.get(env, `HEALTH_${name.replaceAll("-", "_").toUpperCase()}_DB`);
	if (!isDatabase(binding)) throw new Error(`Missing real test database: ${name}`);
	return binding;
}

function isEvidenceRecorder(value: unknown): value is Pick<Fetcher, "fetch"> {
	return (
		value !== null &&
		typeof value === "object" &&
		"fetch" in value &&
		typeof value.fetch === "function"
	);
}
function isDatabase(value: unknown): value is D1Database {
	return (
		value !== null &&
		typeof value === "object" &&
		"prepare" in value &&
		typeof value.prepare === "function" &&
		"batch" in value &&
		typeof value.batch === "function" &&
		"exec" in value &&
		typeof value.exec === "function"
	);
}
