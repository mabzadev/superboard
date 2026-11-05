import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { beforeEach, expect, test } from "vitest";

const migrations = new URL("../../../../apps/site/migrations/", import.meta.url);
const redaction = "0061_redact_command_operation_secrets.sql";
const retainedBody = JSON.stringify({
	algorithm: "AES-GCM",
	iv: "AAAAAAAAAAAAAAAA",
	ciphertext: "c2VjcmV0LWNpcGhlcnRleHQ=",
});
const notRetained = '{"retained":false}';

let database: DatabaseSync;

function applyMigration(name: string) {
	database.exec(readFileSync(new URL(name, migrations), "utf8"));
}

function insertOperation(operationId: string, requestPayload: string) {
	database
		.prepare(
			`INSERT INTO superboard_plugin_command_operations (
			   operation_id, instance_id, project_ref, plugin_id, command_id, adapter_operation, method,
			   request_path_checksum, request_payload_json, request_checksum, state, accepted_at
			 ) VALUES (?, 'reference-production', 'instance-wide', 'supbrd-core', NULL, 'api-v1:supbrd-core',
			   'PUT', ?, ?, ?, 'accepted', '2026-11-01T10:00:00.000Z')`,
		)
		.run(operationId, `sha256:${"1".repeat(64)}`, requestPayload, `sha256:${"2".repeat(64)}`);
}

function operations() {
	return database
		.prepare("SELECT * FROM superboard_plugin_command_operations ORDER BY operation_id")
		.all();
}

function outbox() {
	return database.prepare("SELECT * FROM superboard_plugin_command_outbox ORDER BY event_id").all();
}

function triggers() {
	return database
		.prepare(
			"SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name LIKE 'superboard_plugin_command_%' ORDER BY name",
		)
		.all();
}

function rewrittenOperations() {
	return database
		.prepare("SELECT operation_id FROM temp.rewritten_operations ORDER BY operation_id")
		.all()
		.map(({ operation_id }) => operation_id);
}

beforeEach(() => {
	database = new DatabaseSync(":memory:");
	for (const name of readdirSync(migrations)
		.filter((file) => file.endsWith(".sql") && file < redaction)
		.toSorted())
		applyMigration(name);
	insertOperation("operation-completed", retainedBody);
	database
		.prepare(
			`UPDATE superboard_plugin_command_operations
			 SET state = 'completed', response_status = 200, response_headers_json = '{}',
			     response_payload_json = ?, response_checksum = ?, completed_at = '2026-11-01T10:00:01.000Z'
			 WHERE operation_id = 'operation-completed'`,
		)
		.run(retainedBody, `sha256:${"3".repeat(64)}`);
	insertOperation("operation-interrupted", retainedBody);
	insertOperation("operation-not-retained", notRetained);
	database.exec(`
		CREATE TEMP TABLE rewritten_operations (operation_id TEXT NOT NULL);
		CREATE TEMP TRIGGER record_rewritten_operation
		AFTER UPDATE ON main.superboard_plugin_command_operations
		BEGIN
		  INSERT INTO rewritten_operations VALUES (NEW.operation_id);
		END;
	`);
});

test("replaces only the retained request bodies and keeps the command history intact", () => {
	const historyBefore = operations().map(({ request_payload_json: _, ...row }) => row);
	const outboxBefore = outbox();
	const triggersBefore = triggers();

	applyMigration(redaction);

	expect(rewrittenOperations()).toEqual(["operation-completed", "operation-interrupted"]);
	expect(operations().map(({ request_payload_json }) => request_payload_json)).toEqual([
		notRetained,
		notRetained,
		notRetained,
	]);
	expect(operations().map(({ request_payload_json: _, ...row }) => row)).toEqual(historyBefore);
	expect(operations().at(0)?.response_payload_json).toBe(retainedBody);
	expect(outbox()).toEqual(outboxBefore);
	expect(triggers()).toEqual(
		expect.arrayContaining(triggersBefore.map((trigger) => expect.objectContaining(trigger))),
	);
	expect(() => database.exec("DELETE FROM superboard_plugin_command_operations")).toThrow(
		"append-only",
	);
});

test("can be applied again without touching any row", () => {
	applyMigration(redaction);
	const schema = triggers();
	database.exec("DELETE FROM temp.rewritten_operations");

	applyMigration(redaction);

	expect(rewrittenOperations()).toEqual([]);
	expect(triggers()).toEqual(schema);
});

test("drops a request body still written by a Site version that predates the migration", () => {
	applyMigration(redaction);

	insertOperation("operation-written-by-previous-site", retainedBody);

	expect(
		database
			.prepare(
				"SELECT request_payload_json FROM superboard_plugin_command_operations WHERE operation_id = ?",
			)
			.get("operation-written-by-previous-site"),
	).toEqual({ request_payload_json: notRetained });
	expect(
		database
			.prepare("SELECT event_kind FROM superboard_plugin_command_outbox WHERE operation_id = ?")
			.all("operation-written-by-previous-site"),
	).toEqual([{ event_kind: "accepted" }]);
});
