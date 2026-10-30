import {
	verifyInternalProjectContextRequest,
	type InternalProjectContext,
} from "@superboard/contracts/project-context";
import { readJsonObjectLimited, RequestBodyError } from "@superboard/contracts/request-body";
import { createFetchRouter, type FetchRouteHandler } from "@superboard/contracts/route-registry";

import { FilesInputError } from "./errors.js";
import type { FilesEnv } from "./index.js";

interface Upload {
	id: string;
	project_id: number;
	request_hash: string;
	filename: string;
	content_type: string;
	byte_size: number;
	object_key: string;
	state: string;
	expires_at: string;
}
interface StoredFile extends Upload {
	etag: string;
	deleted_at: string | null;
}
interface Policy {
	maximum: number;
	filename(value: string): string;
	contentType(value: string): string;
	allowed(value: string): void;
}
const operationPattern = /^[A-Za-z0-9._:-]{8,200}$/u;

class FileOperationError extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
	) {
		super(code);
	}
}

interface OperatorEnvironment {
	env: FilesEnv;
	policy: Policy;
}
interface OperationContext extends OperatorEnvironment {
	request: Request;
	actor: InternalProjectContext;
	projectId: number;
	operation: string;
	url: URL;
	params: Record<string, string>;
}
type Operation = (context: OperationContext) => Promise<Response>;
const operatorPrefix = "/internal/v1/operator";
export const operatorFileRoutes = createFetchRouter<OperatorEnvironment>({
	service: "files",
	module: "operator",
	pluginId: "superboard-files",
	surface: "internal",
	access: "internal",
});
function operatorAction(action: Operation): FetchRouteHandler<OperatorEnvironment> {
	return async ({ request, env: configuration, params }): Promise<Response> => {
		const { env, policy } = configuration;
		const verified = await verifyInternalProjectContextRequest(
			request,
			env.FILES_INTERNAL_TOKEN,
			"files",
		);
		if (!verified.ok || !verified.context.operatorId)
			return failure(401, "OPERATOR_CONTEXT_REQUIRED");
		const actor = verified.context;
		const projectId = actor.projectId;
		if (!["owner", "admin"].includes(actor.role)) return failure(403, "OPERATOR_REQUIRED");
		const operation = request.headers.get("Idempotency-Key") ?? "";
		if (request.method !== "GET" && !operationPattern.test(operation))
			return failure(400, "IDEMPOTENCY_KEY_REQUIRED");
		try {
			if (request.method === "HEAD") return failure(404, "NOT_FOUND");
			return await action({
				request,
				env,
				policy,
				actor,
				projectId,
				operation,
				url: new URL(request.url),
				params,
			});
		} catch (error) {
			if (
				error instanceof FileOperationError ||
				error instanceof FilesInputError ||
				error instanceof RequestBodyError
			)
				return failure(error.status, error.code);
			console.error("[files-operator] request failed", error);
			return failure(503, "FILES_UNAVAILABLE");
		}
	};
}
function uploadAction(action: (context: OperationContext, ticket: Upload) => Promise<Response>) {
	return operatorAction(async (state) => {
		const { env, projectId, params } = state;
		const ticket = await env.DB.prepare(
			"SELECT * FROM operator_file_uploads WHERE project_id=? AND id=?",
		)
			.bind(projectId, params.ticketId ?? "")
			.first<Upload>();
		if (!ticket) throw new FileOperationError(404, "UPLOAD_NOT_FOUND");
		if (ticket.state !== "completed" && Date.parse(ticket.expires_at) <= Date.now())
			throw new FileOperationError(410, "UPLOAD_EXPIRED");
		return action(state, ticket);
	});
}
function objectAction(
	action: (context: OperationContext, row: StoredFile) => Promise<Response>,
	options: { includeDeleted?: boolean } = {},
) {
	return operatorAction(async (state) => {
		const { env, projectId, params } = state;
		const row = await file(env, projectId, params.id ?? "");
		if (!row) throw new FileOperationError(404, "FILE_NOT_FOUND");
		if (!options.includeDeleted && row.deleted_at)
			throw new FileOperationError(404, "FILE_NOT_FOUND");
		return action(state, row);
	});
}
operatorFileRoutes.defineRoute({ id: "files:operator:upload-create" }).post(
	operatorPrefix + "/upload-tickets",
	operatorAction(async ({ request, env, policy, projectId, operation, actor }) => {
		const body = await readJsonObjectLimited(request, 16384);
		if (
			typeof body.filename !== "string" ||
			typeof body.content_type !== "string" ||
			!Number.isSafeInteger(body.byte_size) ||
			Number(body.byte_size) < 1 ||
			Number(body.byte_size) > policy.maximum
		)
			throw new FileOperationError(422, "FILE_METADATA_INVALID");
		const name = policy.filename(body.filename);
		const contentType = policy.contentType(body.content_type);
		policy.allowed(contentType);
		const size = Number(body.byte_size);
		const requestHash = await digest(JSON.stringify([name, contentType, size]));
		const id = crypto.randomUUID();
		await env.DB.prepare(
			"INSERT INTO operator_file_uploads(id,project_id,operation_id,request_hash,filename,content_type,byte_size,object_key,state,expires_at,created_at) VALUES (?,?,?,?,?,?,?,?,'created',?,?) ON CONFLICT(project_id,operation_id) DO NOTHING",
		)
			.bind(
				id,
				projectId,
				operation,
				requestHash,
				name,
				contentType,
				size,
				`operator-files/${projectId}/${id}`,
				new Date(Date.now() + 15 * 60000).toISOString(),
				new Date().toISOString(),
			)
			.run();
		const ticket = await env.DB.prepare(
			"SELECT * FROM operator_file_uploads WHERE project_id=? AND operation_id=?",
		)
			.bind(projectId, operation)
			.first<Upload>();
		if (!ticket || ticket.request_hash !== requestHash)
			throw new FileOperationError(409, "UPLOAD_IDEMPOTENCY_CONFLICT");
		return json(
			{
				...ticket,
				upload_url: `/api/v1/files/projects/${actor.projectRef}/upload-tickets/${ticket.id}/content`,
			},
			201,
		);
	}),
);
operatorFileRoutes.defineRoute({ id: "files:operator:upload-content" }).put(
	operatorPrefix + "/upload-tickets/:ticketId/content",
	uploadAction(async ({ request, env, policy, projectId }, ticket) => {
		if (!request.body) throw new FileOperationError(422, "FILE_BODY_REQUIRED");
		const claimed = await env.DB.prepare(
			"UPDATE operator_file_uploads SET state='uploading' WHERE id=? AND project_id=? AND state='created' RETURNING id",
		)
			.bind(ticket.id, projectId)
			.first();
		if (!claimed) throw new FileOperationError(409, "UPLOAD_ALREADY_STARTED");
		let bytes = 0;
		try {
			const bounded = request.body.pipeThrough(
				new TransformStream<Uint8Array, Uint8Array>({
					transform(chunk, controller) {
						bytes += chunk.byteLength;
						if (bytes > ticket.byte_size || bytes > policy.maximum)
							throw new FileOperationError(413, "FILE_TOO_LARGE");
						controller.enqueue(chunk);
					},
					flush() {
						if (bytes !== ticket.byte_size) throw new FileOperationError(422, "FILE_SIZE_MISMATCH");
					},
				}),
			);
			const fixed = new FixedLengthStream(ticket.byte_size);
			const abort = new AbortController();
			const piping = bounded.pipeTo(fixed.writable, {
				signal: AbortSignal.any([abort.signal, AbortSignal.timeout(60000)]),
			});
			const storing = env.FILES.put(ticket.object_key, fixed.readable, {
				httpMetadata: { contentType: ticket.content_type },
			});
			let object: R2Object;
			try {
				[object] = await Promise.all([storing, piping]);
			} catch (error) {
				abort.abort(error);
				await Promise.allSettled([storing, piping]);
				throw error;
			}
			if (bytes !== ticket.byte_size) {
				await env.FILES.delete(ticket.object_key);
				throw new FileOperationError(422, "FILE_SIZE_MISMATCH");
			}
			await env.DB.prepare(
				"UPDATE operator_file_uploads SET state='uploaded',etag=? WHERE id=? AND project_id=? AND state='uploading'",
			)
				.bind(object.etag, ticket.id, projectId)
				.run();
			return json({ id: ticket.id, uploaded: true, byte_size: bytes });
		} catch (error) {
			await env.FILES.delete(ticket.object_key);
			await env.DB.prepare(
				"UPDATE operator_file_uploads SET state='created' WHERE id=? AND project_id=? AND state='uploading'",
			)
				.bind(ticket.id, projectId)
				.run();
			throw error;
		}
	}),
);
operatorFileRoutes.defineRoute({ id: "files:operator:upload-complete" }).post(
	operatorPrefix + "/upload-tickets/:ticketId/complete",
	uploadAction(async ({ env, projectId, actor }, ticket) => {
		const object = await env.FILES.head(ticket.object_key);
		if (!object || object.size !== ticket.byte_size)
			throw new FileOperationError(409, "UPLOAD_NOT_READY");
		await env.DB.batch([
			env.DB.prepare(
				"INSERT INTO operator_files(id,project_id,filename,content_type,byte_size,object_key,etag,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING",
			).bind(
				ticket.id,
				projectId,
				ticket.filename,
				ticket.content_type,
				ticket.byte_size,
				ticket.object_key,
				object.etag,
				actor.operatorId,
				new Date().toISOString(),
			),
			env.DB.prepare(
				"UPDATE operator_file_uploads SET state='completed' WHERE id=? AND project_id=?",
			).bind(ticket.id, projectId),
		]);
		return json(await file(env, projectId, ticket.id), 201);
	}),
);
operatorFileRoutes.defineRoute({ id: "files:operator:objects-list" }).get(
	operatorPrefix + "/objects",
	operatorAction(async ({ env, projectId, url }) => {
		const cursor = url.searchParams.get("cursor") ?? "";
		const deleted = url.searchParams.get("deleted") === "true";
		const rows = await env.DB.prepare(
			"SELECT * FROM operator_files WHERE project_id=? AND id>? AND ((?=0 AND deleted_at IS NULL) OR (?=1 AND deleted_at IS NOT NULL)) ORDER BY id LIMIT 51",
		)
			.bind(projectId, cursor, deleted ? 1 : 0, deleted ? 1 : 0)
			.all<StoredFile>();
		return json({
			items: rows.results.slice(0, 50),
			next_cursor: rows.results.length > 50 ? rows.results[49]!.id : null,
		});
	}),
);
operatorFileRoutes.defineRoute({ id: "files:operator:usage" }).get(
	operatorPrefix + "/usage",
	operatorAction(async ({ env, projectId }) => {
		return json(
			await env.DB.prepare(
				"SELECT COUNT(*) AS files,COALESCE(SUM(byte_size),0) AS bytes FROM operator_files WHERE project_id=? AND deleted_at IS NULL",
			)
				.bind(projectId)
				.first(),
		);
	}),
);
operatorFileRoutes.defineRoute({ id: "files:operator:object-delete" }).delete(
	operatorPrefix + "/objects/:id",
	objectAction(
		async ({ env, projectId }, row) => {
			await env.DB.prepare(
				"UPDATE operator_files SET deleted_at=COALESCE(deleted_at,?) WHERE id=? AND project_id=?",
			)
				.bind(new Date().toISOString(), row.id, projectId)
				.run();
			return json({ id: row.id, deleted: true });
		},
		{ includeDeleted: true },
	),
);
operatorFileRoutes.defineRoute({ id: "files:operator:object-restore" }).post(
	operatorPrefix + "/objects/:id/restore",
	objectAction(
		async ({ env, projectId }, row) => {
			await env.DB.prepare("UPDATE operator_files SET deleted_at=NULL WHERE id=? AND project_id=?")
				.bind(row.id, projectId)
				.run();
			return json({ id: row.id, restored: true });
		},
		{ includeDeleted: true },
	),
);
operatorFileRoutes.defineRoute({ id: "files:operator:object-read" }).get(
	operatorPrefix + "/objects/:id",
	objectAction(async (_state, row) => {
		return json(row);
	}),
);
operatorFileRoutes.defineRoute({ id: "files:operator:object-download-ticket" }).get(
	operatorPrefix + "/objects/:id/download-ticket",
	objectAction(async ({ actor }, row) => {
		return json({
			download_url: `/api/v1/files/projects/${actor.projectRef}/objects/${row.id}/content`,
			authentication: "operator-session",
		});
	}),
);
operatorFileRoutes.defineRoute({ id: "files:operator:object-content" }).get(
	operatorPrefix + "/objects/:id/content",
	objectAction(async ({ env }, row) => {
		const object = await env.FILES.get(row.object_key);
		if (!object) throw new FileOperationError(503, "FILE_STORAGE_UNAVAILABLE");
		return new Response(object.body, {
			headers: {
				"Content-Type": row.content_type,
				"Content-Length": String(object.size),
				"Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(row.filename)}`,
				"Cache-Control": "private, no-store",
				"X-Content-Type-Options": "nosniff",
			},
		});
	}),
);
operatorFileRoutes.defineRoute({ id: "files:operator:collect-garbage" }).post(
	operatorPrefix + "/collect-garbage",
	operatorAction(async ({ env, projectId }) => {
		const rows = await env.DB.prepare(
			"SELECT id,object_key FROM operator_file_uploads WHERE project_id=? AND state IN ('created','uploading','uploaded') AND expires_at<? ORDER BY expires_at LIMIT 50",
		)
			.bind(projectId, new Date().toISOString())
			.all<Upload>();
		for (const row of rows.results) {
			await env.FILES.delete(row.object_key);
			await env.DB.prepare(
				"DELETE FROM operator_file_uploads WHERE project_id=? AND id=? AND state<>'completed'",
			)
				.bind(projectId, row.id)
				.run();
		}
		return json({ collected: rows.results.length, has_more: rows.results.length === 50 });
	}),
);
operatorFileRoutes.defineRoute({ transport: "fallback" }).on(
	"ALL",
	[operatorPrefix, operatorPrefix + "/*"],
	operatorAction(async () => failure(404, "NOT_FOUND")),
);
export function handleOperatorFiles(
	request: Request,
	env: FilesEnv,
	policy: Policy,
): Promise<Response> {
	return operatorFileRoutes.fetch(request, { env, policy });
}

function file(env: FilesEnv, projectId: number, id: string) {
	return env.DB.prepare("SELECT * FROM operator_files WHERE project_id=? AND id=?")
		.bind(projectId, id)
		.first<StoredFile>();
}
function json(data: unknown, status = 200) {
	return Response.json({ data }, { status, headers: { "Cache-Control": "private, no-store" } });
}
function failure(status: number, code: string) {
	return Response.json({ error: { code, message: code } }, { status });
}
async function digest(value: string) {
	return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}
