import {
	signProjectContext,
	type InternalProjectContext,
} from "@superboard/contracts/project-context";
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const secret = "marketing-runtime-secret";

async function signedRequest(path: string, projectId: number, method = "GET", body?: unknown) {
	const context: InternalProjectContext = {
		module: "marketing",
		method,
		pathname: path.split("?")[0]!,
		projectId,
		projectRef: "10-prod",
		instanceId: 10,
		environment: "production",
		actorId: 2,
		role: "owner",
		requestId: crypto.randomUUID(),
		issuedAt: Math.floor(Date.now() / 1000),
	};
	const headers = new Headers({
		"content-type": "application/json",
		"x-internal-token": secret,
		"x-project-id": String(projectId),
		"x-project-ref": context.projectRef,
		"x-instance-id": "10",
		"x-environment": context.environment,
		"x-actor-id": String(context.actorId),
		"x-role": "owner",
		"x-request-id": context.requestId,
		"x-context-issued-at": String(context.issuedAt),
		"x-context-version": "1",
		"x-context-signature": await signProjectContext(context, secret),
	});
	if (method !== "GET") headers.set("idempotency-key", crypto.randomUUID());
	return new Request(`https://marketing.internal${path}`, {
		method,
		headers,
		body: body === undefined ? undefined : JSON.stringify(body),
	});
}

async function call<T>(path: string, projectId: number, method = "GET", body?: unknown) {
	const response = await SELF.fetch(await signedRequest(path, projectId, method, body));
	return { status: response.status, body: (await response.json()) as { data: T } };
}

describe("Marketing suppression management", () => {
	it("lists, adds and lifts manual suppressions without restoring revoked consent", async () => {
		const project = 431;
		const subscriber = await call<{ id: string }>(
			"/internal/v1/email/subscribers",
			project,
			"POST",
			{
				email: "manual-block@example.com",
			},
		);
		expect(subscriber.status).toBe(201);

		const added = await call<{ id: string; reason: string }>(
			"/internal/v1/suppressions",
			project,
			"POST",
			{ email: "Manual-Block@example.com" },
		);
		expect(added.status).toBe(201);
		expect(added.body.data).toMatchObject({ email: "manual-block@example.com", reason: "manual" });
		const blocked = await call<{ status: string }>(
			`/internal/v1/email/subscribers/${subscriber.body.data.id}`,
			project,
		);
		expect(blocked.body.data.status).toBe("blocklisted");

		const listed = await call<Array<{ id: string; email: string }>>(
			"/internal/v1/suppressions?q=manual-block",
			project,
		);
		expect(listed.body.data.map((item) => item.email)).toEqual(["manual-block@example.com"]);

		const removed = await call(
			`/internal/v1/suppressions/${added.body.data.id}`,
			project,
			"DELETE",
		);
		expect(removed.status).toBe(200);
		const restored = await call<{ status: string }>(
			`/internal/v1/email/subscribers/${subscriber.body.data.id}`,
			project,
		);
		expect(restored.body.data.status).toBe("enabled");

		const unsubscribed = await call<{ id: string }>(
			"/internal/v1/email/subscribers",
			project,
			"POST",
			{ email: "left@example.com" },
		);
		await call(
			`/internal/v1/email/subscribers/${unsubscribed.body.data.id}/unsubscribe`,
			project,
			"POST",
			{},
		);
		const [unsubscribe] = (
			await call<Array<{ id: string; reason: string }>>(
				"/internal/v1/suppressions?q=left@",
				project,
			)
		).body.data;
		expect(unsubscribe?.reason).toBe("unsubscribe");
		expect(
			(await call(`/internal/v1/suppressions/${unsubscribe!.id}`, project, "DELETE")).status,
		).toBe(404);
		expect(
			(await call("/internal/v1/suppressions", project, "POST", { email: "left@example.com" }))
				.status,
		).toBe(409);
	});
});
