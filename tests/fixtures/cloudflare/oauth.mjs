import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

export function oauthFixture() {
	const database = new DatabaseSync(":memory:");
	database.exec(
		readFileSync(
			new URL("../../../infra/cloudflare-installer/migrations/0001_sessions.sql", import.meta.url),
			"utf8",
		),
	);
	database.exec(
		readFileSync(
			new URL(
				"../../../infra/cloudflare-installer/migrations/0002_installations.sql",
				import.meta.url,
			),
			"utf8",
		),
	);
	return {
		database,
		env: {
			INSTALLER_ORIGIN: "https://install.example.com",
			INSTALLER_SESSION_KEY: Buffer.alloc(32, 7).toString("base64"),
			CLOUDFLARE_OAUTH_CLIENT_ID: "fixture-client",
			CLOUDFLARE_OAUTH_CLIENT_SECRET: "fixture-client-secret",
			CLOUDFLARE_OAUTH_SCOPES: "fixture-scope",
			INSTALLER_DB: {
				prepare(sql) {
					return {
						bind(...parameters) {
							return {
								async run() {
									return database.prepare(sql).run(...parameters);
								},
								async first() {
									return database.prepare(sql).get(...parameters) ?? null;
								},
								async all() {
									return { results: database.prepare(sql).all(...parameters) };
								},
							};
						},
					};
				},
			},
		},
	};
}
