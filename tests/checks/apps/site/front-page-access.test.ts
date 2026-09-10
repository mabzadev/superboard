import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

import { Role } from "@emdash-cms/auth";
import { compileFrontRelease, type CompiledFrontRelease } from "@superboard/supbrd-core";
import { afterEach, beforeAll, beforeEach, expect, test } from "vitest";

import {
	resolvePreviewFrontPage,
	resolveSiteFrontPage,
} from "../../../../apps/site/src/lib/front-page.js";
import type { SuperBoardSiteEnv } from "../../../../apps/site/src/lib/site-env.js";
import { superBoardRuntimePluginCatalog } from "../../../../apps/site/src/lib/superboard-plugin-catalog.js";
import { composeUserFrontReleaseInput } from "../../../../apps/site/src/lib/user-front-release.js";

const instanceId = "operator-access-test";
const homePath = "/superboard-system/home";
const operator = {
	id: "emdash-operator",
	email: "operator@example.test",
	name: "Operator",
	role: Role.ADMIN,
	disabled: false,
};
let release: CompiledFrontRelease;
let publicJwk: JsonWebKey;
let sqlite: DatabaseSync;
let env: SuperBoardSiteEnv;

beforeAll(async () => {
	const userPlugin = superBoardRuntimePluginCatalog().plugins.find(
		({ manifest }) => manifest.plugin_id === "supbrd-plug-user",
	)?.manifest;
	if (!userPlugin) throw new Error("Missing User plugin");
	const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
		"sign",
		"verify",
	]);
	publicJwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
	release = await compileFrontRelease(
		await composeUserFrontReleaseInput({
			instance_id: instanceId,
			front_draft_id: "01J00000000000000000000801",
			draft_snapshot_id: "01J00000000000000000000802",
			compilation_id: "01J00000000000000000000803",
			candidate_id: "01J00000000000000000000804",
			release_id: "01J00000000000000000000805",
			release_sequence: 1,
			previous_release_id: null,
			created_at: "2026-09-08T12:00:00.000Z",
			plugin_lock: [
				{
					plugin_id: userPlugin.plugin_id,
					version: userPlugin.plugin_version,
					artifact_checksum: userPlugin.artifact_checksum,
					native: userPlugin.execution.backend === "native",
				},
			],
		}),
		{ kid: "operator-access-key", private_key: keys.privateKey },
	);
});

beforeEach(() => {
	sqlite = new DatabaseSync(":memory:");
	for (const migration of [
		"0001_front_release_control_plane.sql",
		"0015_front_permission_grants.sql",
	])
		sqlite.exec(
			readFileSync(
				new URL(`../../../../apps/site/migrations/${migration}`, import.meta.url),
				"utf8",
			),
		);
	const operationMigration = readFileSync(
		new URL("../../../../apps/site/migrations/0021_managed_plugin_operations.sql", import.meta.url),
		"utf8",
	);
	sqlite.exec(operationMigration.slice(0, operationMigration.indexOf(";") + 1));
	sqlite
		.prepare(
			"INSERT INTO superboard_release_signing_keys (kid, public_jwk, status, created_at) VALUES (?, ?, 'active', ?)",
		)
		.run("operator-access-key", JSON.stringify(publicJwk), release.payload.created_at);
	sqlite
		.prepare(`INSERT INTO superboard_front_release_candidates
		(candidate_id, instance_id, release_id, release_json, content_checksum, validation_set_checksum, signing_kid, status, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, 'activated', ?)`)
		.run(
			release.payload.candidate_id,
			instanceId,
			release.payload.release_id,
			JSON.stringify(release),
			release.content_checksum,
			release.validation_set_checksum,
			"operator-access-key",
			release.payload.created_at,
		);
	sqlite
		.prepare(`INSERT INTO superboard_front_active_releases
		(instance_id, active_release_id, pointer_revision, activation_id, activated_at) VALUES (?, ?, 1, 'operator-access-activation', ?)`)
		.run(instanceId, release.payload.release_id, release.payload.created_at);
	for (const dependency of release.payload.dependency_policies)
		sqlite
			.prepare(`INSERT INTO superboard_dependency_health
			(instance_id, dependency_id, status, evidence_checksum, checked_at, expires_at) VALUES (?, ?, 'ready', 'test', ?, '2999-01-01T00:00:00.000Z')`)
			.run(instanceId, dependency.dependency_id, release.payload.created_at);
	const cache = new Map<string, string>();
	env = {
		SUPERBOARD_INSTANCE_ID: instanceId,
		SUPERBOARD_ENVIRONMENT: "local",
		DB: {
			prepare(sql: string) {
				const statement = sqlite.prepare(sql);
				const query = (values: SQLInputValue[]) => ({
					bind: (...bound: SQLInputValue[]) => query(bound),
					first: async () => statement.get(...values) ?? null,
					all: async () => ({ success: true, results: statement.all(...values) }),
				});
				return query([]);
			},
		},
		RELEASE_CACHE: {
			put: async (key: string, value: string) => {
				cache.set(key, value);
			},
			get: async (key: string) => (cache.has(key) ? JSON.parse(cache.get(key)!) : null),
		},
	} as unknown as SuperBoardSiteEnv;
});

afterEach(() => sqlite.close());

test.each([Role.SUBSCRIBER, Role.CONTRIBUTOR, Role.AUTHOR, Role.EDITOR])(
	"refuses the console to EmDash role %i even when the published home allows authenticated users",
	async (role) => {
		const model = await resolveSiteFrontPage(env, homePath, { ...operator, role });
		expect(model.resolution.result).toBe("forbidden");
		expect(model.operator).toBeNull();
		expect(model.permissions).toEqual([]);
	},
);

test("does not let a front permission grant bypass EmDash operator authorization", async () => {
	sqlite
		.prepare(
			"INSERT INTO superboard_front_permission_grants (instance_id, role, permission) VALUES (?, ?, '*')",
		)
		.run(instanceId, Role.SUBSCRIBER);
	const model = await resolveSiteFrontPage(env, "/app/profile", {
		...operator,
		role: Role.SUBSCRIBER,
	});
	expect(model.resolution.result).toBe("forbidden");
	expect(model.operator).toBeNull();
	expect(model.permissions).toEqual([]);
});

test("refuses a disabled EmDash administrator before publishing an operator identity", async () => {
	const model = await resolveSiteFrontPage(env, homePath, { ...operator, disabled: true });
	expect(model.resolution.result).toBe("forbidden");
	expect(model.operator).toBeNull();
	expect(model.permissions).toEqual([]);
});

test("redirects an anonymous console request to the EmDash login", async () => {
	const model = await resolveSiteFrontPage(env, homePath, undefined);
	expect(model.resolution).toMatchObject({
		result: "redirect",
		location: expect.stringMatching(/^\/_emdash\/admin\/login(?:\?|$)/u),
	});
	expect(model.operator).toBeNull();
});

test("renders the console and permitted account page using the active EmDash administrator", async () => {
	for (const path of [homePath, "/app/profile"]) {
		const model = await resolveSiteFrontPage(env, path, operator);
		expect(model.resolution.result).toBe("rendered");
		expect(model.operator).toEqual(operator);
	}
});

test.each([
	"/_emdash/admin/login",
	"/login",
	"/register",
	"/register/with_email",
	"/new_password",
	"/reset_password",
	"/accept-invite",
])("keeps the published anonymous authentication route %s available", async (path) => {
	const model = await resolveSiteFrontPage(env, path, undefined);
	expect(model.resolution.result).toBe("rendered");
	expect(model.operator).toBeNull();
});

test("applies the same EmDash authorization when resolving a preview", async () => {
	for (const user of [
		{ ...operator, role: Role.SUBSCRIBER },
		{ ...operator, disabled: true },
	]) {
		const model = await resolvePreviewFrontPage(env, release, homePath, user);
		expect(model.resolution.result).toBe("forbidden");
		expect(model.operator).toBeNull();
	}
	expect((await resolvePreviewFrontPage(env, release, homePath, operator)).resolution.result).toBe(
		"rendered",
	);
	expect((await resolvePreviewFrontPage(env, release, "/login", undefined)).resolution.result).toBe(
		"rendered",
	);
});

test("denies an unauthorized home before the first release while preserving the administrator fallback", async () => {
	sqlite.exec("DELETE FROM superboard_front_active_releases");
	for (const user of [
		{ ...operator, role: Role.SUBSCRIBER },
		{ ...operator, disabled: true },
	]) {
		const model = await resolveSiteFrontPage(env, homePath, user);
		expect(model.release).toBeNull();
		expect(model.resolution.result).toBe("forbidden");
		expect(model.operator).toBeNull();
	}
	const anonymous = await resolveSiteFrontPage(env, homePath, undefined);
	expect(anonymous.resolution).toMatchObject({
		result: "redirect",
		location: expect.stringMatching(/^\/_emdash\/admin\/login(?:\?|$)/u),
	});
	const allowed = await resolveSiteFrontPage(env, homePath, operator);
	expect(allowed.release).toBeNull();
	expect(allowed.operator).toEqual(operator);
});
