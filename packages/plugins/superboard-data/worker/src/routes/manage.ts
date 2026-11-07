import { registerRouter } from "@superboard/contracts/route-registry";
import { Hono } from "hono";

import { typescriptTypes } from "../database/codegen.js";
import { applySchema } from "../database/declarative.js";
import { deleteRows, insertRows, listRows, updateRows } from "../database/records.js";
import {
	addColumn,
	countRows,
	createTable,
	dropColumn,
	dropTable,
	listTables,
	parseTableInput,
	requireTable,
	updateColumn,
	updateTable,
} from "../database/schema.js";
import { runReadOnlySql } from "../database/sql-console.js";
import {
	deleteFunction,
	deleteSchedule,
	deployFunction,
	functionDetails,
	listFunctions,
	listRuns,
	rollbackFunction,
	setSchedule,
} from "../functions/registry.js";
import { invokeFunction } from "../functions/runtime.js";
import { secretsAvailable } from "../functions/secrets.js";
import { createServiceKey, listServiceKeys, revokeServiceKey } from "../keys.js";
import { resolveOperatorCaller, resolveServiceCaller, type Caller } from "../platform/caller.js";
import type { DataEnv } from "../platform/env.js";
import { DataError, isRecord, json, readJsonBody, readJsonObject } from "../platform/http.js";
import { invalidateRealtime, publishChanges, realtimeStub } from "../realtime/publish.js";
import { getProjectSettings, updateProjectSettings } from "../settings.js";
import {
	createBucket,
	deleteBucket,
	listBuckets,
	requireBucket,
	updateBucket,
} from "../storage/buckets.js";
import {
	deleteObject,
	listObjects,
	objectResponse,
	putObject,
	readableObject,
} from "../storage/objects.js";
import {
	createCollection,
	deleteCollection,
	listCollections,
	updateCollection,
	vectorsAvailable,
} from "../vectors/collections.js";
import {
	DATA_PLUGIN_ID,
	action,
	deferralOf,
	searchParams,
	wildcardPath,
	type DataContext,
	param,
} from "./context.js";

type Resolver = (c: DataContext) => Promise<Caller>;

function confirmation(c: DataContext): string | null {
	return searchParams(c).get("confirm");
}

function managementRouter(options: {
	module: string;
	access: "sdk-key" | "internal";
	prefix: string;
	idPrefix: string;
	resolve: Resolver;
}) {
	const router = registerRouter(new Hono<{ Bindings: DataEnv }>(), {
		service: "files",
		module: options.module,
		pluginId: DATA_PLUGIN_ID,
		surface: "internal",
		access: options.access,
	});
	const { prefix, idPrefix, resolve } = options;
	const route = (id: string) => router.defineRoute({ id: `${idPrefix}:${id}` });
	const handle = (scope: string, handler: (c: DataContext, caller: Caller) => Promise<Response>) =>
		action(`${options.module}-${scope}`, async (c) => handler(c, await resolve(c)));

	route("status").get(
		`${prefix}/status`,
		handle("status", async (c, caller) => {
			const [tables, buckets, functions] = await Promise.all([
				listTables(c.env, caller.projectId),
				listBuckets(c.env, caller.projectId),
				listFunctions(c.env, caller.projectId),
			]);
			return json({
				project_id: caller.projectId,
				features: {
					realtime: Boolean(c.env.REALTIME),
					functions: Boolean(c.env.LOADER),
					function_secrets: secretsAvailable(c.env),
					image_transformations: Boolean(c.env.IMAGES),
					vectors: vectorsAvailable(c.env),
				},
				counts: { tables: tables.length, buckets: buckets.length, functions: functions.length },
			});
		}),
	);

	route("tables-list").get(
		`${prefix}/tables`,
		handle("tables-list", async (c, caller) =>
			json({ items: await listTables(c.env, caller.projectId) }),
		),
	);
	route("tables-create").post(
		`${prefix}/tables`,
		handle("tables-create", async (c, caller) => {
			const table = await createTable(
				c.env,
				caller.projectId,
				parseTableInput(await readJsonBody(c.req.raw)),
			);
			invalidateRealtime(c.env, deferralOf(c), caller.projectId);
			return json(table, 201);
		}),
	);
	route("table-get").get(
		`${prefix}/tables/:table`,
		handle("table-get", async (c, caller) => {
			const table = await requireTable(c.env, caller.projectId, param(c, "table"));
			return json({ ...table, row_count: await countRows(c.env, caller.projectId, table.name) });
		}),
	);
	route("table-update").patch(
		`${prefix}/tables/:table`,
		handle("table-update", async (c, caller) => {
			const table = await updateTable(
				c.env,
				caller.projectId,
				param(c, "table"),
				await readJsonBody(c.req.raw),
			);
			invalidateRealtime(c.env, deferralOf(c), caller.projectId);
			return json(table);
		}),
	);
	route("table-delete").delete(
		`${prefix}/tables/:table`,
		handle("table-delete", async (c, caller) => {
			await dropTable(c.env, caller.projectId, param(c, "table"), confirmation(c));
			invalidateRealtime(c.env, deferralOf(c), caller.projectId);
			return json({ deleted: true });
		}),
	);
	route("column-add").post(
		`${prefix}/tables/:table/columns`,
		handle("column-add", async (c, caller) =>
			json(
				await addColumn(c.env, caller.projectId, param(c, "table"), await readJsonBody(c.req.raw)),
				201,
			),
		),
	);
	route("column-update").patch(
		`${prefix}/tables/:table/columns/:column`,
		handle("column-update", async (c, caller) =>
			json(
				await updateColumn(
					c.env,
					caller.projectId,
					param(c, "table"),
					param(c, "column"),
					await readJsonBody(c.req.raw),
				),
			),
		),
	);
	route("column-delete").delete(
		`${prefix}/tables/:table/columns/:column`,
		handle("column-delete", async (c, caller) =>
			json(
				await dropColumn(
					c.env,
					caller.projectId,
					param(c, "table"),
					param(c, "column"),
					confirmation(c),
				),
			),
		),
	);
	route("schema-apply").post(
		`${prefix}/schema`,
		handle("schema-apply", async (c, caller) => {
			const params = searchParams(c);
			return json(
				await applySchema(c.env, caller.projectId, await readJsonBody(c.req.raw, 2_097_152), {
					dryRun: params.get("dry_run") === "true",
					allowDestructive: params.get("allow_destructive") === "true",
				}),
			);
		}),
	);
	route("types").get(
		`${prefix}/types`,
		handle("types", async (c, caller) => {
			const response = new Response(typescriptTypes(await listTables(c.env, caller.projectId)));
			response.headers.set("content-type", "text/plain; charset=utf-8");
			response.headers.set("cache-control", "no-store");
			return response;
		}),
	);
	route("settings-get").get(
		`${prefix}/settings`,
		handle("settings-get", async (c, caller) =>
			json(await getProjectSettings(c.env, caller.projectId)),
		),
	);
	route("settings-update").patch(
		`${prefix}/settings`,
		handle("settings-update", async (c, caller) => {
			const settings = await updateProjectSettings(
				c.env,
				caller.projectId,
				await readJsonBody(c.req.raw),
			);
			invalidateRealtime(c.env, deferralOf(c), caller.projectId);
			return json(settings);
		}),
	);

	route("buckets-list").get(
		`${prefix}/buckets`,
		handle("buckets-list", async (c, caller) =>
			json({ items: await listBuckets(c.env, caller.projectId) }),
		),
	);
	route("buckets-create").post(
		`${prefix}/buckets`,
		handle("buckets-create", async (c, caller) =>
			json(await createBucket(c.env, caller.projectId, await readJsonBody(c.req.raw)), 201),
		),
	);
	route("bucket-update").patch(
		`${prefix}/buckets/:bucket`,
		handle("bucket-update", async (c, caller) =>
			json(
				await updateBucket(
					c.env,
					caller.projectId,
					param(c, "bucket"),
					await readJsonBody(c.req.raw),
				),
			),
		),
	);
	route("bucket-delete").delete(
		`${prefix}/buckets/:bucket`,
		handle("bucket-delete", async (c, caller) => {
			await deleteBucket(c.env, caller.projectId, param(c, "bucket"), confirmation(c));
			return json({ deleted: true });
		}),
	);

	route("functions-list").get(
		`${prefix}/functions`,
		handle("functions-list", async (c, caller) =>
			json({ items: await listFunctions(c.env, caller.projectId) }),
		),
	);
	route("function-get").get(
		`${prefix}/functions/:name`,
		handle("function-get", async (c, caller) =>
			json(await functionDetails(c.env, caller.projectId, param(c, "name"))),
		),
	);
	route("function-deploy").put(
		`${prefix}/functions/:name`,
		handle("function-deploy", async (c, caller) =>
			json(
				await deployFunction(
					c.env,
					caller.projectId,
					param(c, "name"),
					await readJsonBody(c.req.raw, 1_200_000),
					caller.operatorId ?? caller.keyId,
				),
			),
		),
	);
	route("function-delete").delete(
		`${prefix}/functions/:name`,
		handle("function-delete", async (c, caller) => {
			await deleteFunction(c.env, caller.projectId, param(c, "name"), confirmation(c));
			return json({ deleted: true });
		}),
	);
	route("function-rollback").post(
		`${prefix}/functions/:name/rollback`,
		handle("function-rollback", async (c, caller) =>
			json(
				await rollbackFunction(
					c.env,
					caller.projectId,
					param(c, "name"),
					await readJsonBody(c.req.raw),
				),
			),
		),
	);
	route("function-runs").get(
		`${prefix}/functions/:name/runs`,
		handle("function-runs", async (c, caller) =>
			json(await listRuns(c.env, caller.projectId, param(c, "name"), searchParams(c))),
		),
	);
	route("function-schedule-set").put(
		`${prefix}/functions/:name/schedule`,
		handle("function-schedule-set", async (c, caller) =>
			json(
				await setSchedule(c.env, caller.projectId, param(c, "name"), await readJsonBody(c.req.raw)),
			),
		),
	);
	route("function-schedule-delete").delete(
		`${prefix}/functions/:name/schedule`,
		handle("function-schedule-delete", async (c, caller) => {
			await deleteSchedule(c.env, caller.projectId, param(c, "name"));
			return json({ deleted: true });
		}),
	);
	route("function-invoke").post(
		`${prefix}/functions/:name/invoke`,
		handle("function-invoke", async (c, caller) => {
			const body = await readJsonObject(c.req.raw, 1_048_576);
			const method = typeof body.method === "string" ? body.method.toUpperCase() : "POST";
			if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method))
				throw new DataError(422, "method_invalid", "method is GET, POST, PUT, PATCH or DELETE");
			const headers = new Headers({ "content-type": "application/json" });
			if (isRecord(body.headers))
				for (const [name, value] of Object.entries(body.headers))
					if (typeof value === "string") headers.set(name, value);
			const payload =
				method === "GET" || body.body === undefined
					? null
					: typeof body.body === "string"
						? body.body
						: JSON.stringify(body.body);
			const result = await invokeFunction(c.env, deferralOf(c), {
				projectId: caller.projectId,
				name: param(c, "name"),
				caller: null,
				trigger: "test",
				request: new Request("https://functions.internal/", { method, headers, body: payload }),
				path: typeof body.path === "string" ? body.path : "/",
			});
			const text = await result.response.text();
			return json({
				run_id: result.runId,
				status: result.response.status,
				headers: Object.fromEntries(result.response.headers),
				body: text.slice(0, 65_536),
				logs: result.logs,
				duration_ms: result.durationMs,
			});
		}),
	);

	route("vector-collections-list").get(
		`${prefix}/vector-collections`,
		handle("vector-collections-list", async (c, caller) =>
			json({
				items: await listCollections(c.env, caller.projectId),
				available: vectorsAvailable(c.env),
			}),
		),
	);
	route("vector-collections-create").post(
		`${prefix}/vector-collections`,
		handle("vector-collections-create", async (c, caller) =>
			json(await createCollection(c.env, caller.projectId, await readJsonBody(c.req.raw)), 201),
		),
	);
	route("vector-collection-update").patch(
		`${prefix}/vector-collections/:collection`,
		handle("vector-collection-update", async (c, caller) =>
			json(
				await updateCollection(
					c.env,
					caller.projectId,
					param(c, "collection"),
					await readJsonBody(c.req.raw),
				),
			),
		),
	);
	route("vector-collection-delete").delete(
		`${prefix}/vector-collections/:collection`,
		handle("vector-collection-delete", async (c, caller) => {
			await deleteCollection(c.env, caller.projectId, param(c, "collection"), confirmation(c));
			return json({ deleted: true });
		}),
	);

	return { router, route, handle };
}

export const manageRoutes = managementRouter({
	module: "manage",
	access: "sdk-key",
	prefix: "/v1/manage",
	idPrefix: "data:manage",
	resolve: (c) => resolveServiceCaller(c.req.raw, c.env, deferralOf(c)),
}).router;

const operator = managementRouter({
	module: "operator-data",
	access: "internal",
	prefix: "/internal/v1/operator/data",
	idPrefix: "data:operator",
	resolve: (c) => resolveOperatorCaller(c.req.raw, c.env),
});
const operatorPrefix = "/internal/v1/operator/data";

operator.route("keys-list").get(
	`${operatorPrefix}/keys`,
	operator.handle("keys-list", async (c, caller) =>
		json({ items: await listServiceKeys(c.env, caller.projectId) }),
	),
);
operator.route("keys-create").post(
	`${operatorPrefix}/keys`,
	operator.handle("keys-create", async (c, caller) => {
		const body = await readJsonObject(c.req.raw, 4_096);
		return json(await createServiceKey(c.env, caller.projectId, body.name, caller.operatorId), 201);
	}),
);
operator.route("key-revoke").delete(
	`${operatorPrefix}/keys/:id`,
	operator.handle("key-revoke", async (c, caller) => {
		await revokeServiceKey(c.env, caller.projectId, param(c, "id"));
		return json({ revoked: true });
	}),
);
operator.route("sql").post(
	`${operatorPrefix}/sql`,
	operator.handle("sql", async (c, caller) =>
		json(await runReadOnlySql(c.env, caller.projectId, await readJsonBody(c.req.raw))),
	),
);
operator.route("realtime-stats").get(
	`${operatorPrefix}/realtime`,
	operator.handle("realtime-stats", async (c, caller) => {
		const stub = realtimeStub(c.env, caller.projectId);
		if (!stub) return json({ available: false, connections: 0, channels: [] });
		const stats = (await (await stub.fetch("https://realtime.internal/stats")).json()) as Record<
			string,
			unknown
		>;
		return json({ available: true, ...stats });
	}),
);
operator.route("rows-list").get(
	`${operatorPrefix}/tables/:table/rows`,
	operator.handle("rows-list", async (c, caller) => {
		const table = await requireTable(c.env, caller.projectId, param(c, "table"));
		return json(await listRows(c.env, caller, caller.projectId, table, searchParams(c)));
	}),
);
operator.route("rows-insert").post(
	`${operatorPrefix}/tables/:table/rows`,
	operator.handle("rows-insert", async (c, caller) => {
		const table = await requireTable(c.env, caller.projectId, param(c, "table"));
		const result = await insertRows(
			c.env,
			caller,
			caller.projectId,
			table,
			await readJsonBody(c.req.raw),
			{
				upsert: false,
			},
		);
		publishChanges(c.env, deferralOf(c), caller.projectId, table, result.changes);
		return json(result.rows[0], 201);
	}),
);
operator.route("row-update").patch(
	`${operatorPrefix}/tables/:table/rows/:id`,
	operator.handle("row-update", async (c, caller) => {
		const table = await requireTable(c.env, caller.projectId, param(c, "table"));
		const result = await updateRows(
			c.env,
			caller,
			caller.projectId,
			table,
			{ id: param(c, "id") },
			await readJsonBody(c.req.raw),
		);
		publishChanges(c.env, deferralOf(c), caller.projectId, table, result.changes);
		return json(result.rows[0]);
	}),
);
operator.route("row-delete").delete(
	`${operatorPrefix}/tables/:table/rows/:id`,
	operator.handle("row-delete", async (c, caller) => {
		const table = await requireTable(c.env, caller.projectId, param(c, "table"));
		const result = await deleteRows(c.env, caller, caller.projectId, table, { id: param(c, "id") });
		publishChanges(c.env, deferralOf(c), caller.projectId, table, result.changes);
		return json({ deleted: true });
	}),
);
operator.route("objects-list").get(
	`${operatorPrefix}/buckets/:bucket/objects`,
	operator.handle("objects-list", async (c, caller) => {
		const bucket = await requireBucket(c.env, caller.projectId, param(c, "bucket"));
		return json(await listObjects(c.env, caller, bucket, searchParams(c)));
	}),
);
operator.route("object-get").get(
	`${operatorPrefix}/buckets/:bucket/objects/*`,
	operator.handle("object-get", async (c, caller) => {
		const bucket = await requireBucket(c.env, caller.projectId, param(c, "bucket"));
		const path = wildcardPath(c, `${operatorPrefix}/buckets/${bucket.name}/objects/`);
		const object = await readableObject(c.env, caller, bucket, path);
		return objectResponse(c.env, caller.projectId, object, c.req.raw, "private, no-store");
	}),
);
operator.route("object-put").put(
	`${operatorPrefix}/buckets/:bucket/objects/*`,
	operator.handle("object-put", async (c, caller) => {
		const bucket = await requireBucket(c.env, caller.projectId, param(c, "bucket"));
		const path = wildcardPath(c, `${operatorPrefix}/buckets/${bucket.name}/objects/`);
		return json(await putObject(c.env, caller, bucket, path, c.req.raw, true), 201);
	}),
);
operator.route("object-delete").delete(
	`${operatorPrefix}/buckets/:bucket/objects/*`,
	operator.handle("object-delete", async (c, caller) => {
		const bucket = await requireBucket(c.env, caller.projectId, param(c, "bucket"));
		const path = wildcardPath(c, `${operatorPrefix}/buckets/${bucket.name}/objects/`);
		return json({ deleted: true, item: await deleteObject(c.env, caller, bucket, path) });
	}),
);

export const operatorDataRoutes = operator.router;
