import type {
	SiteOperatorIdentity,
	OperatorProjectScope,
	OperatorProjectSummary,
} from "@superboard/contracts/site-operator";

export type { OperatorProjectScope } from "@superboard/contracts/site-operator";

export async function resolveSiteOperatorInstance(
	db: D1Database,
	instanceSlug: string,
): Promise<number | null> {
	const linked = await db
		.prepare("SELECT instance_id FROM site_operator_instances WHERE instance_slug = ?")
		.bind(instanceSlug)
		.first<{ instance_id: number }>();
	if (linked) return linked.instance_id;
	const instance = await db
		.prepare(
			"SELECT id FROM instances WHERE uri_scheme = ? AND NOT EXISTS (SELECT 1 FROM site_operator_instances WHERE instance_id = instances.id)",
		)
		.bind(instanceSlug)
		.first<{ id: number }>();
	return instance?.id ?? null;
}

export async function readSiteOperatorProjectScope(
	db: D1Database,
	identity: SiteOperatorIdentity,
): Promise<OperatorProjectScope | null> {
	const instanceId = await resolveSiteOperatorInstance(db, identity.instance_id);
	if (!instanceId) return null;
	const [instance, projectRows] = await Promise.all([
		db
			.prepare(
				"SELECT id, uri_scheme, get_started_dismissed, created_at, updated_at FROM instances WHERE id = ?",
			)
			.bind(instanceId)
			.first<{
				id: number;
				uri_scheme: string;
				get_started_dismissed: number;
				created_at: string;
				updated_at: string;
			}>(),
		db
			.prepare(
				"SELECT id, name, identifier, is_test, created_at, updated_at FROM projects WHERE instance_id = ? AND is_test IN (0, 1) ORDER BY is_test, id",
			)
			.bind(instanceId)
			.all<{
				id: number;
				name: string;
				identifier: string;
				is_test: number;
				created_at: string;
				updated_at: string;
			}>(),
	]);
	if (!instance) return null;
	const productionRows = projectRows.results.filter(({ is_test }) => is_test === 0);
	const testRows = projectRows.results.filter(({ is_test }) => is_test === 1);
	if (productionRows.length > 1 || testRows.length > 1)
		throw new Error("OPERATOR_INSTANCE_SCOPE_CONFLICT");
	if (!productionRows.length || !testRows.length) return null;
	const projects: OperatorProjectSummary[] = projectRows.results.map((row) => ({
		id: `${instanceId}-${row.is_test ? "test" : "prod"}`,
		internal_id: String(row.id),
		name: row.name,
		identifier: row.identifier,
		is_test: row.is_test === 1,
		created_at: row.created_at,
		updated_at: row.updated_at,
	}));
	return {
		production_project_ref: `${instanceId}-prod`,
		test_project_ref: `${instanceId}-test`,
		projects,
		instance: {
			id: String(instance.id),
			name: instance.uri_scheme,
			uri_scheme: instance.uri_scheme,
			get_started_dismissed: instance.get_started_dismissed === 1,
			created_at: instance.created_at,
			updated_at: instance.updated_at,
			production: projects[0]!,
			test: projects[1]!,
			projects,
		},
	};
}

export async function initializeSiteOperatorProjectScope(
	db: D1Database,
	identity: SiteOperatorIdentity,
	legacyInstanceId?: number,
): Promise<OperatorProjectScope> {
	const linked = await db
		.prepare("SELECT instance_id FROM site_operator_instances WHERE instance_slug = ?")
		.bind(identity.instance_id)
		.first<{ instance_id: number }>();
	if (linked && legacyInstanceId !== undefined && linked.instance_id !== legacyInstanceId)
		throw new Error("OPERATOR_INSTANCE_SCOPE_CONFLICT");
	let instanceId = linked?.instance_id ?? null;
	if (!instanceId && legacyInstanceId !== undefined) {
		if (!Number.isSafeInteger(legacyInstanceId) || legacyInstanceId <= 0)
			throw new Error("OPERATOR_INSTANCE_SCOPE_INVALID");
		const candidate = await db
			.prepare(
				"SELECT id FROM instances WHERE id = ? AND NOT EXISTS (SELECT 1 FROM site_operator_instances WHERE instance_id = instances.id)",
			)
			.bind(legacyInstanceId)
			.first<{ id: number }>();
		if (!candidate) throw new Error("OPERATOR_INSTANCE_SCOPE_CONFLICT");
		instanceId = candidate.id;
	}
	instanceId ??= await resolveSiteOperatorInstance(db, identity.instance_id);
	if (!instanceId) {
		if (await db.prepare("SELECT 1 AS existing FROM instances LIMIT 1").first())
			throw new Error("OPERATOR_INSTANCE_SCOPE_CONFLICT");
		await db
			.prepare(
				"INSERT INTO instances (uri_scheme, api_key) SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM instances)",
			)
			.bind(identity.instance_id, crypto.randomUUID())
			.run();
		instanceId = await resolveSiteOperatorInstance(db, identity.instance_id);
	}
	if (!instanceId) throw new Error("OPERATOR_INSTANCE_SCOPE_CONFLICT");
	await db.batch([
		db
			.prepare(
				"INSERT INTO site_operator_instances (instance_slug, instance_id, linked_by) VALUES (?, ?, ?) ON CONFLICT(instance_slug) DO NOTHING",
			)
			.bind(identity.instance_id, instanceId, identity.operator_id),
		...[0, 1].map((isTest) =>
			db
				.prepare(
					"INSERT INTO projects (instance_id, is_test, name, identifier) SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM site_operator_instances WHERE instance_slug = ? AND instance_id = ?) AND NOT EXISTS (SELECT 1 FROM projects WHERE instance_id = ? AND is_test = ?)",
				)
				.bind(
					instanceId,
					isTest,
					isTest ? `${identity.instance_id} Test` : identity.instance_id,
					`site_${instanceId}_${isTest ? "test" : "prod"}`,
					identity.instance_id,
					instanceId,
					instanceId,
					isTest,
				),
		),
	]);
	const actual = await resolveSiteOperatorInstance(db, identity.instance_id);
	if (actual !== instanceId) throw new Error("OPERATOR_INSTANCE_SCOPE_CONFLICT");
	const scope = await readSiteOperatorProjectScope(db, identity);
	if (!scope) throw new Error("OPERATOR_PROJECT_SCOPE_UNAVAILABLE");
	return scope;
}
