import { readFileSync } from "node:fs";

import { ApiError } from "./errors.js";

export const VERSION = JSON.parse(
	readFileSync(new URL("../package.json", import.meta.url), "utf8"),
).version;

export function encodePath(path) {
	return path.split("/").map(encodeURIComponent).join("/");
}

async function failure(response) {
	let payload = null;
	try {
		payload = await response.json();
	} catch {
		payload = null;
	}
	const error = payload && typeof payload.error === "object" && payload.error ? payload.error : {};
	return new ApiError(
		typeof error.code === "string" ? error.code : `http_${response.status}`,
		typeof error.message === "string"
			? error.message
			: `Request failed with HTTP ${response.status}`,
		response.status,
		error.details,
		error.retryable === true || response.status === 429 || response.status >= 500,
	);
}

export function createApi({ url, secretKey, fetch = globalThis.fetch }) {
	return {
		url,
		async request(method, path, { query = [], json, body, headers = {}, as = "json" } = {}) {
			const target = new URL(`${url}/v1/data${path}`);
			for (const [name, value] of query)
				if (value !== undefined && value !== null && value !== false)
					target.searchParams.append(name, String(value));
			const requestHeaders = {
				Authorization: `Bearer ${secretKey}`,
				Accept: as === "json" ? "application/json" : "*/*",
				"User-Agent": `superboard-cli/${VERSION}`,
				...headers,
			};
			if (json !== undefined) requestHeaders["Content-Type"] = "application/json";
			const payload = json === undefined ? body : JSON.stringify(json);
			const response = await fetch(target, {
				method,
				headers: requestHeaders,
				...(payload === undefined ? {} : { body: payload }),
				redirect: "error",
			});
			if (!response.ok) throw await failure(response);
			if (as === "response") return response;
			if (as === "text") return response.text();
			if (response.status === 204) return null;
			try {
				return await response.json();
			} catch {
				throw new ApiError("invalid_response", "The server returned invalid JSON", response.status);
			}
		},
	};
}
