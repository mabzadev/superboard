import { registerRouter } from "@superboard/contracts/route-registry";
import { Hono } from "hono";

import { invokeFunction } from "../functions/runtime.js";
import { resolveCaller } from "../platform/caller.js";
import type { DataEnv } from "../platform/env.js";
import { json, readJsonBody } from "../platform/http.js";
import {
	deleteItem,
	embeddings,
	queryItems,
	requireCollection,
	upsertItems,
} from "../vectors/collections.js";
import {
	DATA_PLUGINS,
	action,
	deferralOf,
	wildcardPath,
	type DataContext,
	param,
} from "./context.js";

export const functionRoutes = registerRouter(new Hono<{ Bindings: DataEnv }>(), {
	service: "files",
	module: "functions",
	pluginId: DATA_PLUGINS.functions,
	surface: "internal",
	access: "sdk-key",
});

export const vectorRoutes = registerRouter(new Hono<{ Bindings: DataEnv }>(), {
	service: "files",
	module: "vectors",
	pluginId: DATA_PLUGINS.vectors,
	surface: "internal",
	access: "sdk-key",
});

async function invoke(c: DataContext, path: string): Promise<Response> {
	const caller = await resolveCaller(c.req.raw, c.env, deferralOf(c));
	const result = await invokeFunction(c.env, deferralOf(c), {
		projectId: caller.projectId,
		name: param(c, "name"),
		caller,
		trigger: "http",
		request: c.req.raw,
		path,
	});
	return result.response;
}

functionRoutes.defineRoute({ id: "data:functions:invoke-root" }).all(
	"/v1/functions/:name",
	action("function-invoke", (c) => invoke(c, "/")),
);

functionRoutes.defineRoute({ id: "data:functions:invoke-path" }).all(
	"/v1/functions/:name/*",
	action("function-invoke", (c) =>
		invoke(c, `/${wildcardPath(c, `/v1/functions/${param(c, "name")}/`)}`),
	),
);

vectorRoutes.defineRoute({ id: "data:vectors:upsert" }).post(
	"/v1/vectors/:collection/upsert",
	action("vectors-upsert", async (c) => {
		const caller = await resolveCaller(c.req.raw, c.env, deferralOf(c));
		const collection = await requireCollection(c.env, caller.projectId, param(c, "collection"));
		return json(
			await upsertItems(c.env, caller, collection, await readJsonBody(c.req.raw, 4_194_304)),
		);
	}),
);

vectorRoutes.defineRoute({ id: "data:vectors:query" }).post(
	"/v1/vectors/:collection/query",
	action("vectors-query", async (c) => {
		const caller = await resolveCaller(c.req.raw, c.env, deferralOf(c));
		const collection = await requireCollection(c.env, caller.projectId, param(c, "collection"));
		return json(
			await queryItems(c.env, caller, collection, await readJsonBody(c.req.raw, 131_072)),
		);
	}),
);

vectorRoutes.defineRoute({ id: "data:vectors:delete" }).delete(
	"/v1/vectors/:collection/:id",
	action("vectors-delete", async (c) => {
		const caller = await resolveCaller(c.req.raw, c.env, deferralOf(c));
		const collection = await requireCollection(c.env, caller.projectId, param(c, "collection"));
		await deleteItem(c.env, caller, collection, param(c, "id"));
		return json({ deleted: true });
	}),
);

vectorRoutes.defineRoute({ id: "data:ai:embeddings" }).post(
	"/v1/ai/embeddings",
	action("ai-embeddings", async (c) => {
		const caller = await resolveCaller(c.req.raw, c.env, deferralOf(c));
		return json(await embeddings(c.env, caller, await readJsonBody(c.req.raw, 1_048_576)));
	}),
);
