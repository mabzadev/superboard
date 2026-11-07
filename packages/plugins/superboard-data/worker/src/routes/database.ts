import { registerRouter } from "@superboard/contracts/route-registry";
import { Hono } from "hono";

import { openApiDocument } from "../database/codegen.js";
import { deleteRows, getRow, insertRows, listRows, updateRows } from "../database/records.js";
import { listTables, requireTable } from "../database/schema.js";
import { resolveCaller } from "../platform/caller.js";
import type { DataEnv } from "../platform/env.js";
import { json, readJsonBody } from "../platform/http.js";
import { allows } from "../platform/policy.js";
import { publicOrigin } from "../platform/signing.js";
import { publishChanges } from "../realtime/publish.js";
import {
	DATA_PLUGIN_ID,
	action,
	deferralOf,
	searchParams,
	type DataContext,
	param,
} from "./context.js";

export const databaseRoutes = registerRouter(new Hono<{ Bindings: DataEnv }>(), {
	service: "files",
	module: "database",
	pluginId: DATA_PLUGIN_ID,
	surface: "internal",
	access: "sdk-key",
});

const MAXIMUM_WRITE_BYTES = 1_048_576;

async function context(c: DataContext) {
	const caller = await resolveCaller(c.req.raw, c.env, deferralOf(c));
	const table = await requireTable(c.env, caller.projectId, param(c, "table"));
	return { caller, table };
}

databaseRoutes.defineRoute({ id: "data:database:openapi" }).get(
	"/v1/openapi.json",
	action("openapi", async (c) => {
		const caller = await resolveCaller(c.req.raw, c.env, deferralOf(c));
		const tables = (await listTables(c.env, caller.projectId)).filter((table) =>
			allows(table.rules.read, caller),
		);
		return json(openApiDocument(tables, publicOrigin(c.env)));
	}),
);

databaseRoutes.defineRoute({ id: "data:database:rows-list" }).get(
	"/v1/db/:table",
	action("rows-list", async (c) => {
		const { caller, table } = await context(c);
		return json(await listRows(c.env, caller, caller.projectId, table, searchParams(c)));
	}),
);

databaseRoutes.defineRoute({ id: "data:database:rows-insert" }).post(
	"/v1/db/:table",
	action("rows-insert", async (c) => {
		const { caller, table } = await context(c);
		const body = await readJsonBody(c.req.raw, MAXIMUM_WRITE_BYTES);
		const result = await insertRows(c.env, caller, caller.projectId, table, body, {
			upsert: searchParams(c).get("upsert") === "true",
		});
		publishChanges(c.env, deferralOf(c), caller.projectId, table, result.changes);
		return json(Array.isArray(body) ? { items: result.rows } : result.rows[0], 201);
	}),
);

databaseRoutes.defineRoute({ id: "data:database:rows-update-filtered" }).patch(
	"/v1/db/:table",
	action("rows-update", async (c) => {
		const { caller, table } = await context(c);
		const body = await readJsonBody(c.req.raw, MAXIMUM_WRITE_BYTES);
		const result = await updateRows(
			c.env,
			caller,
			caller.projectId,
			table,
			{ params: searchParams(c) },
			body,
		);
		publishChanges(c.env, deferralOf(c), caller.projectId, table, result.changes);
		return json({ items: result.rows });
	}),
);

databaseRoutes.defineRoute({ id: "data:database:rows-delete-filtered" }).delete(
	"/v1/db/:table",
	action("rows-delete", async (c) => {
		const { caller, table } = await context(c);
		const result = await deleteRows(c.env, caller, caller.projectId, table, {
			params: searchParams(c),
		});
		publishChanges(c.env, deferralOf(c), caller.projectId, table, result.changes);
		return json({ items: result.rows });
	}),
);

databaseRoutes.defineRoute({ id: "data:database:row-get" }).get(
	"/v1/db/:table/:id",
	action("row-get", async (c) => {
		const { caller, table } = await context(c);
		return json(
			await getRow(c.env, caller, caller.projectId, table, param(c, "id"), searchParams(c)),
		);
	}),
);

databaseRoutes.defineRoute({ id: "data:database:row-update" }).patch(
	"/v1/db/:table/:id",
	action("row-update", async (c) => {
		const { caller, table } = await context(c);
		const body = await readJsonBody(c.req.raw, MAXIMUM_WRITE_BYTES);
		const result = await updateRows(
			c.env,
			caller,
			caller.projectId,
			table,
			{ id: param(c, "id") },
			body,
		);
		publishChanges(c.env, deferralOf(c), caller.projectId, table, result.changes);
		return json(result.rows[0]);
	}),
);

databaseRoutes.defineRoute({ id: "data:database:row-delete" }).delete(
	"/v1/db/:table/:id",
	action("row-delete", async (c) => {
		const { caller, table } = await context(c);
		const result = await deleteRows(c.env, caller, caller.projectId, table, { id: param(c, "id") });
		publishChanges(c.env, deferralOf(c), caller.projectId, table, result.changes);
		return json({ deleted: true, item: result.rows[0] });
	}),
);
