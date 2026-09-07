import { signProjectContext } from "@superboard/contracts/project-context";
import { SELF } from "cloudflare:test";
import { expect, test } from "vitest";

const secret = "flows-runtime-secret";
const projectRef = "10-test";

test("custom component types preserve the SDK's PascalCase names", async () => {
	await request("GET", `/internal/v1/projects/${projectRef}/project`);
	const createdLibrary = await request(
		"POST",
		`/internal/v1/projects/${projectRef}/component-libraries`,
		{ name: "SDK widgets", identifier: "sdk-widgets" },
	);
	expect(createdLibrary.status).toBe(201);
	const library = ((await createdLibrary.json()) as { data: { id: string } }).data;
	const response = await request("POST", `/internal/v1/projects/${projectRef}/components`, {
		library_id: library.id,
		name: "Exact SDK modal",
		key: "exact-modal",
		component_type: "BasicsV2Modal",
		schema: { template_type: "component" },
		exit_nodes: ["continue", "close"],
		css_variables: {},
	});
	expect(response.status).toBe(201);
	const saved = ((await response.json()) as { data: { id: string } }).data;
	const listing = await request("GET", `/internal/v1/projects/${projectRef}/components`);
	const items = (
		(await listing.json()) as { data: { items: { id: string; component_type: string }[] } }
	).data.items;
	expect(items.find((item) => item.id === saved.id)?.component_type).toBe("BasicsV2Modal");
	const invalid = await request("POST", `/internal/v1/projects/${projectRef}/components`, {
		library_id: library.id,
		name: "Invalid type",
		key: "invalid-type",
		component_type: "../Unsafe",
		schema: {},
		exit_nodes: [],
		css_variables: {},
	});
	expect(invalid.status).toBe(422);
});

async function request(
	method: string,
	path: string,
	body?: unknown,
	idempotencyKey: string = crypto.randomUUID(),
): Promise<Response> {
	const headers = await signedHeaders(method, path);
	if (body !== undefined) headers.set("content-type", "application/json");
	if (!["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase())) {
		headers.set("idempotency-key", idempotencyKey);
	}
	return SELF.fetch(`https://flows.internal${path}`, {
		method,
		headers,
		body: body === undefined ? undefined : JSON.stringify(body),
	});
}

async function signedHeaders(method: string, pathname: string, actorId = 2): Promise<Headers> {
	const issuedAt = Math.floor(Date.now() / 1_000);
	const requestId = crypto.randomUUID();
	const context = {
		module: "flows" as const,
		method,
		pathname,
		projectId: 11,
		projectRef,
		instanceId: 10,
		environment: "test" as const,
		actorId,
		role: "owner",
		requestId,
		issuedAt,
	};
	return new Headers({
		"x-internal-token": secret,
		"x-project-id": "11",
		"x-project-ref": projectRef,
		"x-instance-id": "10",
		"x-environment": "test",
		"x-actor-id": String(actorId),
		"x-role": "owner",
		"x-request-id": requestId,
		"x-context-issued-at": String(issuedAt),
		"x-context-version": "1",
		"x-context-signature": await signProjectContext(context, secret),
	});
}
