import { createServer, type IncomingMessage } from "node:http";

import { createPluginApiClient } from "@superboard/front-ui/api";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const requests: {
	method: string;
	path: string;
	headers: IncomingMessage["headers"];
	body: unknown;
}[] = [];
let origin: string;
let sessionStatus = 200;
const server = createServer(async (request, response) => {
	const chunks = [];
	for await (const chunk of request) chunks.push(chunk);
	const text = Buffer.concat(chunks).toString();
	requests.push({
		method: request.method!,
		path: request.url!,
		headers: request.headers,
		body: text
			? request.headers["content-type"]?.includes("multipart/form-data")
				? text
				: JSON.parse(text)
			: undefined,
	});
	response.setHeader("content-type", "application/json");
	response.statusCode =
		request.url === "/_emdash/api/auth/me"
			? sessionStatus
			: request.url === "/api/v1/unavailable"
				? 401
				: 200;
	response.end(
		JSON.stringify(
			response.statusCode === 200
				? { saved: true }
				: { error: { code: "UNAUTHORIZED", message: "Worker identity unavailable" } },
		),
	);
});

beforeAll(async () => {
	await new Promise<void>((resolve) => {
		server.listen(0, "127.0.0.1", resolve);
	});
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Missing HTTP test address");
	origin = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
	await new Promise<void>((resolve, reject) =>
		server.close((error) => {
			if (error) {
				reject(error);
				return;
			}
			resolve();
		}),
	);
});
afterEach(() => {
	requests.length = 0;
	sessionStatus = 200;
	vi.unstubAllGlobals();
});

function browser() {
	const assign = vi.fn();
	vi.stubGlobal("location", { origin, pathname: "/paywalls", search: "?tab=versions", assign });
	return assign;
}

describe("plugin frontend transport", () => {
	it("preserves multipart upload bytes and sends adapter metadata separately", async () => {
		browser();
		const client = createPluginApiClient("supbrd-plugmod-files", [
			{
				id: "files.command.upload",
				kind: "command",
				operations: [
					{ method: "POST", path: "/api/v1/files/:projectRef", query: "none", body: "passthrough" },
				],
			},
		]);
		const body = new FormData();
		body.set("file", new Blob(["unique-upload-content"], { type: "text/plain" }), "example.txt");
		await client.POST("/api/v1/files/project-ref-42", body);
		expect(requests[0]?.path).toBe(
			"/_emdash/api/superboard/plugins/supbrd-plugmod-files/commands/files.command.upload",
		);
		expect(requests[0]?.headers["x-superboard-adapter-request"]).toBe(
			'{"method":"POST","path":"/api/v1/files/project-ref-42"}',
		);
		expect(requests[0]?.headers["content-type"]).toContain("multipart/form-data; boundary=");
		expect(requests[0]?.body).toContain('filename="example.txt"');
		expect(requests[0]?.body).toContain("unique-upload-content");
	});
	it("dispatches a real mutation through its plugin command with CSRF and one idempotency key", async () => {
		browser();
		const client = createPluginApiClient("supbrd-plugmod-paywalls", [
			{
				id: "supbrd-plugmod-paywalls.command.create_paywall",
				kind: "command",
				operations: [
					{
						method: "POST",
						path: "/api/v1/paywalls/projects/:projectRef",
						query: "none",
						body: "passthrough",
						parameter_values: {},
					},
				],
			},
		]);
		const result = await client.POST(
			"/api/v1/paywalls/projects/project-ref-42",
			{ identifier: "welcome", display_name: "Welcome" },
			{ headers: { "Idempotency-Key": "one-click-42" } },
		);
		expect(result.data).toEqual({ saved: true });
		expect(requests).toHaveLength(1);
		expect(requests[0]).toMatchObject({
			method: "POST",
			path: "/_emdash/api/superboard/plugins/supbrd-plugmod-paywalls/commands/supbrd-plugmod-paywalls.command.create_paywall",
			headers: { "x-emdash-request": "1", "idempotency-key": "one-click-42" },
			body: {
				method: "POST",
				path: "/api/v1/paywalls/projects/project-ref-42",
				body: { identifier: "welcome", display_name: "Welcome" },
			},
		});
		expect(requests[0]?.headers.authorization).toBeUndefined();
	});
	it("keeps a Worker 401 local when the operator session is valid", async () => {
		const assign = browser();
		await expect(
			createPluginApiClient("supbrd-plug-user").GET("/api/v1/unavailable"),
		).rejects.toMatchObject({ status: 401, message: "Worker identity unavailable" });
		expect(assign).not.toHaveBeenCalled();
		expect(requests.map(({ path }) => path)).toEqual([
			"/api/v1/unavailable",
			"/_emdash/api/auth/me",
		]);
	});
	it("returns to the requested URL after a truly expired operator session", async () => {
		const assign = browser();
		sessionStatus = 401;
		await expect(
			createPluginApiClient("supbrd-plug-user").GET("/api/v1/unavailable"),
		).rejects.toMatchObject({ status: 401 });
		expect(assign).toHaveBeenCalledWith(
			"/_emdash/admin/login?redirect=%2Fpaywalls%3Ftab%3Dversions",
		);
		expect(requests.some(({ path }) => path.includes("/auth/refresh"))).toBe(false);
	});
	it("rejects protocol-relative paths and URL-normalized cross-origin paths before transport", async () => {
		browser();
		const client = createPluginApiClient("supbrd-plug-user");
		for (const path of ["//attacker.test/", "/\\attacker.test/", "/\n/attacker.test/"])
			await expect(client.GET(path)).rejects.toMatchObject({ code: "INVALID_API_PATH" });
		expect(requests).toHaveLength(0);
	});
});
