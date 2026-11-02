import type { FetchHandlerObject } from "@atcute/client";

import { FakeRepo } from "./fake-repo.js";
import type { AtprotoDid } from "./types.js";

interface MockPdsCall {
	method: string;
	pathname: string;
	body?: unknown;
}

export class MockPds implements FetchHandlerObject {
	readonly calls: MockPdsCall[] = [];
	private repos = new Map<AtprotoDid, FakeRepo>();

	mount(repo: FakeRepo): void {
		this.repos.set(repo.did, repo);
	}

	getRepo(did: AtprotoDid): FakeRepo | undefined {
		return this.repos.get(did);
	}

	callsTo(nsid: string): MockPdsCall[] {
		return this.calls.filter((c) => c.pathname.startsWith(`/xrpc/${nsid}`));
	}

	async handle(pathname: string, init: RequestInit): Promise<Response> {
		const url = new URL(pathname, "http://mock.test");
		const method = init.method?.toLowerCase() ?? "get";

		const body = await readJsonBody(init.body);
		this.calls.push({ method, pathname, ...(body !== undefined ? { body } : {}) });

		const route = `${method} ${url.pathname}`;
		switch (route) {
			case "get /xrpc/com.atproto.repo.getRecord":
				return this.repoGetRecord(url);
			case "get /xrpc/com.atproto.repo.listRecords":
				return this.repoListRecords(url);
			case "post /xrpc/com.atproto.repo.applyWrites":
				return this.repoApplyWrites(body);
			case "post /xrpc/com.atproto.repo.putRecord":
				return this.repoPutRecord(body);
			case "get /xrpc/com.atproto.sync.getRecord":
				return this.syncGetRecord(url);
			default: {
				const knownRoutes = new Set([
					"/xrpc/com.atproto.repo.getRecord",
					"/xrpc/com.atproto.repo.listRecords",
					"/xrpc/com.atproto.repo.applyWrites",
					"/xrpc/com.atproto.repo.putRecord",
					"/xrpc/com.atproto.sync.getRecord",
				]);
				if (knownRoutes.has(url.pathname)) {
					return jsonResponse(405, {
						error: "MethodNotAllowed",
						message: `${method.toUpperCase()} not allowed on ${url.pathname}`,
					});
				}
				return jsonResponse(404, {
					error: "MethodNotFound",
					message: `MockPds does not implement ${url.pathname}`,
				});
			}
		}
	}

	asFetch(baseUrl: string): typeof fetch {
		const base = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
		return async (input: Request | string | URL, init?: RequestInit): Promise<Response> => {
			const url =
				typeof input === "string" || input instanceof URL ? new URL(input) : new URL(input.url);
			const target = `${url.origin}${url.pathname}${url.search}`;
			if (!target.startsWith(base)) {
				throw new Error(`MockPds.asFetch: outbound request not directed at ${base}: ${target}`);
			}
			const localPath = `${url.pathname}${url.search}`;
			const reqInit: RequestInit = init ?? {};
			if (input instanceof Request) {
				return this.handle(localPath, {
					method: input.method,
					headers: input.headers,
					body: input.body ?? undefined,
				});
			}
			return this.handle(localPath, reqInit);
		};
	}

	private repoGetRecord(url: URL): Response {
		const did = parseDid(url.searchParams.get("repo"));
		if (!did) return invalidRequest("missing or malformed repo");
		const collection = url.searchParams.get("collection");
		const rkey = url.searchParams.get("rkey");
		if (!collection || !rkey) return invalidRequest("missing collection or rkey");
		const repo = this.repos.get(did);
		if (!repo) return notFound("RepoNotFound", `MockPds does not host ${did}`);
		const value = repo.getRecordValue(collection, rkey);
		if (value === undefined) {
			return notFound(
				"RecordNotFound",
				`Could not locate record: at://${did}/${collection}/${rkey}`,
			);
		}
		return jsonResponse(200, {
			uri: `at://${did}/${collection}/${rkey}`,
			cid: cidPlaceholder(),
			value,
		});
	}

	private repoListRecords(url: URL): Response {
		const did = parseDid(url.searchParams.get("repo"));
		if (!did) return invalidRequest("missing or malformed repo");
		const collection = url.searchParams.get("collection");
		if (!collection) return invalidRequest("missing collection");
		const repo = this.repos.get(did);
		if (!repo) return notFound("RepoNotFound", `MockPds does not host ${did}`);
		const items = repo.listRecords(collection).map((r) => ({
			uri: r.uri,
			cid: cidPlaceholder(),
			value: r.value,
		}));
		return jsonResponse(200, { records: items });
	}

	private async repoApplyWrites(body: unknown): Promise<Response> {
		if (!body || typeof body !== "object") return invalidRequest("missing body");
		const b = body as { repo?: string; writes?: Array<Record<string, unknown>> };
		const did = parseDid(b.repo);
		if (!did) return invalidRequest("missing or malformed repo");
		const repo = this.repos.get(did);
		if (!repo) return notFound("RepoNotFound", `MockPds does not host ${did}`);
		if (!Array.isArray(b.writes)) return invalidRequest("writes must be an array");
		for (const w of b.writes) {
			const op = w as {
				$type?: string;
				collection?: string;
				rkey?: string;
				value?: Record<string, unknown>;
			};
			if (!op.collection || !op.rkey) {
				return invalidRequest(`write missing collection or rkey on ${String(op.$type)}`);
			}
			switch (op.$type) {
				case "com.atproto.repo.applyWrites#create":
					if (!op.value) return invalidRequest("create write missing value");
					await repo.putRecord(op.collection, op.rkey, op.value);
					break;
				case "com.atproto.repo.applyWrites#update":
					if (!op.value) return invalidRequest("update write missing value");
					await repo.updateRecord(op.collection, op.rkey, op.value);
					break;
				case "com.atproto.repo.applyWrites#delete":
					await repo.deleteRecord(op.collection, op.rkey);
					break;
				default:
					return invalidRequest(`unsupported write $type: ${String(op.$type)}`);
			}
		}
		return jsonResponse(200, { results: b.writes.map(() => ({})) });
	}

	private async repoPutRecord(body: unknown): Promise<Response> {
		if (!body || typeof body !== "object") return invalidRequest("missing body");
		const b = body as {
			repo?: string;
			collection?: string;
			rkey?: string;
			record?: Record<string, unknown>;
		};
		const did = parseDid(b.repo);
		if (!did) return invalidRequest("missing or malformed repo");
		const repo = this.repos.get(did);
		if (!repo) return notFound("RepoNotFound", `MockPds does not host ${did}`);
		if (!b.collection || !b.rkey || !b.record) {
			return invalidRequest("putRecord missing collection, rkey, or record");
		}
		await repo.putRecord(b.collection, b.rkey, b.record);
		return jsonResponse(200, {
			uri: `at://${did}/${b.collection}/${b.rkey}`,
			cid: cidPlaceholder(),
		});
	}

	private async syncGetRecord(url: URL): Promise<Response> {
		const did = parseDid(url.searchParams.get("did"));
		if (!did) return invalidRequest("missing or malformed did");
		const collection = url.searchParams.get("collection");
		const rkey = url.searchParams.get("rkey");
		if (!collection || !rkey) return invalidRequest("missing collection or rkey");
		const repo = this.repos.get(did);
		if (!repo) return notFound("RepoNotFound", `MockPds does not host ${did}`);
		try {
			const car = await repo.getRecordCar(collection, rkey);
			return new Response(car, {
				status: 200,
				headers: {
					"Content-Type": "application/vnd.ipld.car",
					"Content-Length": car.length.toString(),
				},
			});
		} catch (err) {
			return jsonResponse(500, {
				error: "InternalServerError",
				message: err instanceof Error ? err.message : "failed to build proof CAR",
			});
		}
	}
}

async function readJsonBody(body: RequestInit["body"] | undefined): Promise<unknown> {
	if (body === null || body === undefined) return undefined;
	if (typeof body === "string") {
		try {
			return JSON.parse(body);
		} catch {
			return body;
		}
	}
	if (body instanceof Uint8Array) {
		try {
			return JSON.parse(new TextDecoder().decode(body));
		} catch {
			return body;
		}
	}
	if (body instanceof ReadableStream) {
		const text = await new Response(body).text();
		try {
			return JSON.parse(text);
		} catch {
			return text;
		}
	}
	return body;
}

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function invalidRequest(message: string): Response {
	return jsonResponse(400, { error: "InvalidRequest", message });
}

function notFound(error: string, message: string): Response {
	return jsonResponse(404, { error, message });
}

function parseDid(value: string | null | undefined): AtprotoDid | null {
	if (!value) return null;
	if (!value.startsWith("did:plc:") && !value.startsWith("did:web:")) return null;
	return value as AtprotoDid;
}

function cidPlaceholder(): string {
	return "bafyreigtest000000000000000000000000000000000000000000000";
}
