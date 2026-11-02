import { describe, it, expect } from "vitest";

import { generatePluginWrapper } from "../../../../packages/workerd/src/sandbox/wrapper.js";

function extractMarshalRequestInit(): (init: unknown) => Promise<any> {
	const src = generatePluginWrapper(
		{
			id: "test-plugin",
			name: "test",
			version: "1.0.0",
			capabilities: [],
			storage: [],
		} as any,
		{
			backingServiceUrl: "http://127.0.0.1:1",
			authToken: "x",
			invokeToken: "y",
		},
	);
	const marker = "async function marshalRequestInit(init) {";
	const startIdx = src.indexOf(marker);
	if (startIdx === -1) {
		throw new Error("marshalRequestInit not found in wrapper output");
	}
	const openBraceIdx = src.indexOf("{", startIdx);
	let depth = 0;
	let endIdx = -1;
	for (let i = openBraceIdx; i < src.length; i++) {
		const ch = src[i];
		if (ch === "{") depth++;
		else if (ch === "}") {
			depth--;
			if (depth === 0) {
				endIdx = i;
				break;
			}
		}
	}
	if (endIdx === -1) {
		throw new Error("Could not find matching closing brace for marshalRequestInit");
	}
	const body = src.slice(startIdx, endIdx + 1);
	// eslint-disable-next-line no-implied-eval
	const factory = new Function(`${body}\nreturn marshalRequestInit;`);
	return factory();
}

describe("marshalRequestInit: URLSearchParams body", () => {
	it("sets content-type as an array pair (not an object property)", async () => {
		const marshal = extractMarshalRequestInit();
		const result = await marshal({
			method: "POST",
			body: new URLSearchParams({ a: "1", b: "2" }),
		});
		expect(result.bodyType).toBe("string");
		expect(result.body).toBe("a=1&b=2");
		expect(Array.isArray(result.headers)).toBe(true);
		expect(result.headers).toContainEqual(["content-type", "application/x-www-form-urlencoded"]);
		const roundtripped = JSON.parse(JSON.stringify(result));
		expect(roundtripped.headers).toContainEqual([
			"content-type",
			"application/x-www-form-urlencoded",
		]);
	});

	it("preserves caller-provided content-type instead of overwriting", async () => {
		const marshal = extractMarshalRequestInit();
		const result = await marshal({
			method: "POST",
			headers: { "Content-Type": "text/plain" },
			body: new URLSearchParams({ x: "1" }),
		});
		const ctEntries = result.headers.filter(
			([k]: [string, string]) => k.toLowerCase() === "content-type",
		);
		expect(ctEntries).toHaveLength(1);
		expect(ctEntries[0][1]).toBe("text/plain");
	});

	it("works when no headers were provided by the caller", async () => {
		const marshal = extractMarshalRequestInit();
		const result = await marshal({ body: new URLSearchParams({ x: "1" }) });
		expect(Array.isArray(result.headers)).toBe(true);
		expect(result.headers).toContainEqual(["content-type", "application/x-www-form-urlencoded"]);
	});
});
