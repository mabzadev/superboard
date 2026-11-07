import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

const directory = join(
	import.meta.dirname,
	"../../../../../../packages/plugins/superboard-acquisition/dynamic-links/migrations",
);
const migrations = readdirSync(directory)
	.filter((name) => name.endsWith(".sql"))
	.toSorted();
const beforeDnsProof = migrations.filter((name) => name <= "0004_link_metadata_and_defaults.sql");
const afterDnsProof = migrations.filter((name) => name > "0004_link_metadata_and_defaults.sql");

function apply(database: DatabaseSync, names: string[]) {
	for (const name of names) database.exec(readFileSync(join(directory, name), "utf8"));
}

function status(database: DatabaseSync, id: string) {
	return database.prepare("SELECT status, verified_at FROM domains WHERE id = ?").get(id);
}

describe("dynamic-links domain migrations", () => {
	it("returns domains marked verified without a DNS proof to pending", () => {
		const database = new DatabaseSync(":memory:");
		apply(database, beforeDnsProof);
		database.exec(`
			INSERT INTO domains (id, project_id, hostname, status, verification_token, verified_at)
			VALUES ('legacy', '11', 'go.example.test', 'verified', 'token-1', '2026-10-01 10:00:00');
			INSERT INTO domains (id, project_id, hostname, status, verification_token)
			VALUES ('waiting', '11', 'links.example.test', 'pending', 'token-2');
		`);
		apply(database, afterDnsProof);
		expect(status(database, "legacy")).toEqual({ status: "pending", verified_at: null });
		expect(status(database, "waiting")).toEqual({ status: "pending", verified_at: null });
	});

	it("keeps a domain verified once a DNS proof is recorded", () => {
		const database = new DatabaseSync(":memory:");
		apply(database, migrations);
		database.exec(`
			INSERT INTO domains (id, project_id, hostname, status, verification_token, verified_at, dns_verified_at)
			VALUES ('proven', '11', 'go.example.test', 'verified', 'token-1', '2026-11-06 10:00:00', '2026-11-06 10:00:00');
		`);
		for (const name of afterDnsProof)
			for (const statement of readFileSync(join(directory, name), "utf8").split(";"))
				if (/^\s*UPDATE\b/iu.test(statement)) database.exec(statement);
		expect(status(database, "proven")).toEqual({
			status: "verified",
			verified_at: "2026-11-06 10:00:00",
		});
	});
});
