import {
	createApi,
	type BaseQueryFn,
	type FetchArgs,
	type FetchBaseQueryError,
} from "@reduxjs/toolkit/query/react";

import { ApiError } from "../../../../../../../supbrd-front-ui/src/shared/lib/ApiError.js";
import * as client from "../../../transport.js";
import type { AppState } from "../../stores/app.js";

const methods = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
type Method = (typeof methods)[number];
function isMethod(value: string): value is Method {
	return methods.some((method) => method === value);
}

function requestHeaders(value: FetchArgs["headers"]): Record<string, string> {
	if (value instanceof Headers) return Object.fromEntries(value);
	if (Array.isArray(value)) return Object.fromEntries(value);
	return Object.fromEntries(
		Object.entries(value ?? {}).filter(
			(entry): entry is [string, string] => typeof entry[1] === "string",
		),
	);
}

const projectBaseQuery: BaseQueryFn<string | FetchArgs, unknown, FetchBaseQueryError> = async (
	args,
	api,
) => {
	const projectRef = (api.getState() as { app?: AppState }).app?.projectRef;
	if (!projectRef)
		return {
			error: {
				status: 409,
				data: {
					error: {
						code: "identity_project_required",
						message: "Select a project before using Identity.",
					},
				},
			},
		};
	const original = typeof args === "string" ? { url: args } : args;
	const method = original.method?.toUpperCase() ?? "GET";
	if (!isMethod(method))
		return {
			error: {
				status: 405,
				data: { error: { code: "METHOD_NOT_ALLOWED", message: "Unsupported Identity method" } },
			},
		};
	const resource = original.url.startsWith("/") ? original.url : `/${original.url}`;
	const query = new URLSearchParams();
	for (const [name, value] of Object.entries(original.params ?? {}))
		if (value !== undefined) query.set(name, String(value));
	const path = `/api/v1/identity-admin/projects/${encodeURIComponent(projectRef)}${resource}${query.size ? `?${query}` : ""}`;
	try {
		const response = await client.request(method, path, original.body, {
			signal: api.signal,
			headers: requestHeaders(original.headers),
		});
		return { data: response.data };
	} catch (error) {
		if (error instanceof ApiError)
			return {
				error: {
					status: error.status,
					data: { error: { message: error.message, code: error.code } },
				},
			};
		return {
			error: {
				status: "FETCH_ERROR",
				error: error instanceof Error ? error.message : "Identity request failed",
			},
		};
	}
};

export const authApi = createApi({
	reducerPath: "identityAuthApi",
	baseQuery: projectBaseQuery,
	endpoints: () => ({}),
});
