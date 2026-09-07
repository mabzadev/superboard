import { z } from "zod";

import {
	appendAuditEntry,
	archiveAuditLedger,
	listAuditEntries,
	verifyAuditLedger,
} from "../../../../packages/supbrd-runtime-plugins/src/server/audit.js";
import { nativePluginStore } from "./native-plugin-store.js";

const archiveInput = z.object({
	from_sequence: z.number().int().positive(),
	to_sequence: z.number().int().positive(),
});
interface JournalFact {
	operation_id: string;
	plugin_id: string;
	action: string;
	status: string;
	checksum: string | null;
	completed_at: string;
}

export async function dispatchAuditPluginApi(
	request: Request,
	env: { DB: D1Database; SUPERBOARD_INSTANCE_ID: string },
): Promise<Response> {
	const instance = env.SUPERBOARD_INSTANCE_ID;
	const store = nativePluginStore(env.DB);
	const url = new URL(request.url);
	const resource = url.pathname.slice("/_emdash/api/superboard/audit".length);
	try {
		if (request.method === "GET" && (resource === "/ledger" || resource === "/ledger/search"))
			return Response.json({
				data: await listAuditEntries(
					store,
					instance,
					Number(url.searchParams.get("cursor") ?? 0),
					url.searchParams.get("search") ?? "",
				),
			});
		if (request.method === "GET" && resource === "/archives")
			return Response.json({
				data: {
					items: await store.all(
						"SELECT archive_id,from_sequence,to_sequence,checksum,created_at FROM superboard_audit_archives WHERE instance_id=? ORDER BY created_at DESC LIMIT 100",
						[instance],
					),
				},
			});
		if (request.method === "POST" && resource === "/verify") {
			const cursor = (
				await store.all<{ completed_at: string; operation_id: string }>(
					"SELECT completed_at,operation_id FROM superboard_audit_cursors WHERE instance_id=?",
					[instance],
				)
			)[0];
			const facts = await store.all<JournalFact>(
				`SELECT * FROM (
 SELECT 'command:'||operation_id AS operation_id,plugin_id,COALESCE(command_id,adapter_operation) AS action,state AS status,response_checksum AS checksum,completed_at FROM superboard_plugin_command_operations WHERE instance_id=? AND state<>'accepted' AND completed_at IS NOT NULL
 UNION ALL SELECT 'lifecycle:'||operation_id AS operation_id,plugin_id,action,status,snapshot_checksum AS checksum,completed_at FROM superboard_managed_plugin_operations WHERE instance_id=? AND status<>'running' AND completed_at IS NOT NULL
 ) WHERE completed_at>? OR (completed_at=? AND operation_id>?) ORDER BY completed_at,operation_id LIMIT 101`,
				[
					instance,
					instance,
					cursor?.completed_at ?? "",
					cursor?.completed_at ?? "",
					cursor?.operation_id ?? "",
				],
			);
			for (const fact of facts.slice(0, 100))
				await appendAuditEntry(store, instance, fact.operation_id, fact);
			const last = facts.slice(0, 100).at(-1);
			if (last)
				await store.batch([
					{
						sql: "INSERT INTO superboard_audit_cursors(instance_id,completed_at,operation_id) VALUES (?,?,?) ON CONFLICT(instance_id) DO UPDATE SET completed_at=excluded.completed_at,operation_id=excluded.operation_id WHERE superboard_audit_cursors.completed_at<excluded.completed_at OR (superboard_audit_cursors.completed_at=excluded.completed_at AND superboard_audit_cursors.operation_id<excluded.operation_id)",
						values: [instance, last.completed_at, last.operation_id],
					},
				]);
			return Response.json({
				data: {
					...(await verifyAuditLedger(store, instance)),
					imported: Math.min(facts.length, 100),
					has_more: facts.length > 100,
				},
			});
		}
		if (request.method === "POST" && resource === "/archives") {
			const body = archiveInput.parse(await request.json());
			const id = request.headers.get("Idempotency-Key");
			if (!id)
				return Response.json({ error: { code: "IDEMPOTENCY_KEY_REQUIRED" } }, { status: 400 });
			return Response.json(
				{
					data: await archiveAuditLedger(store, instance, id, body.from_sequence, body.to_sequence),
				},
				{ status: 201 },
			);
		}
		return Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
	} catch (error) {
		if (error instanceof z.ZodError)
			return Response.json({ error: { code: "AUDIT_INPUT_INVALID" } }, { status: 422 });
		const code =
			error instanceof Error && error.message.startsWith("AUDIT_")
				? error.message
				: "AUDIT_UNAVAILABLE";
		return Response.json({ error: { code } }, { status: code === "AUDIT_UNAVAILABLE" ? 503 : 409 });
	}
}
