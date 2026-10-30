import { parseAnalyticsEventV1, type AnalyticsEventV1 } from "./analytics.js";
import { checkpointPluginTask, signPluginTaskRequest } from "./plugin-task.js";
import type { ProjectEnvironment } from "./project-context.js";
import { readJsonLimited } from "./request-body.js";

export interface CollectionProject {
	projectId: number;
	instanceId: number;
	projectRef: string;
	environment: ProjectEnvironment;
}
export interface CollectedEvent {
	sequence: number;
	event: AnalyticsEventV1;
	trusted: boolean;
	format: "analytics" | "customer";
	receivedAt: string;
	project: CollectionProject;
}
export interface CollectionPage {
	items: CollectedEvent[];
	nextCursor: number;
	hasMore: boolean;
}
export interface CollectionReader {
	API_SERVICE: { fetch(request: Request): Promise<Response> };
	INTERNAL_API_TOKEN: string;
}

export async function fetchCollectionPage(
	env: CollectionReader,
	pluginId: string,
	projectId: number,
	after: number,
	eventNames: readonly string[] = [],
): Promise<CollectionPage> {
	const query = new URLSearchParams({
		project_id: String(projectId),
		after: String(after),
		limit: "100",
	});
	for (const name of eventNames) query.append("event_name", name);
	const page = parsePage(await collectionRequest(env, pluginId, `events?${query}`));
	const items = page.items.map((value): CollectedEvent => {
		const item = record(value);
		if (item.format !== "analytics" && item.format !== "customer")
			throw new Error("Invalid collection format");
		if (typeof item.trusted !== "boolean" || typeof item.receivedAt !== "string")
			throw new Error("Invalid collected event");
		return {
			sequence: positiveInteger(item.sequence),
			event: parseAnalyticsEventV1(item.event, { allowReserved: item.trusted }),
			trusted: item.trusted,
			format: item.format,
			receivedAt: item.receivedAt,
			project: parseProject(item.project),
		};
	});
	return { ...page, items };
}

export async function fetchCollectionProjects(
	env: CollectionReader,
	pluginId: string,
	after = 0,
): Promise<{ items: CollectionProject[]; nextCursor: number; hasMore: boolean }> {
	const page = parsePage(await collectionRequest(env, pluginId, `projects?after=${after}`));
	return { ...page, items: page.items.map(parseProject) };
}

async function collectionRequest(
	env: CollectionReader,
	pluginId: string,
	path: string,
): Promise<unknown> {
	const request = new Request(
		`https://api.internal/internal/collection/v1/${encodeURIComponent(pluginId)}/${path}`,
		{ signal: AbortSignal.timeout(30_000) },
	);
	const headers = await signPluginTaskRequest(request, env.INTERNAL_API_TOKEN);
	const response = await env.API_SERVICE.fetch(new Request(request, { headers }));
	if (!response.ok) throw new Error(`Core collection read failed: ${response.status}`);
	const body = await readJsonLimited(response, 8 * 1024 * 1024);
	if (!body || typeof body !== "object" || !("data" in body))
		throw new Error("Invalid core collection response");
	return body.data;
}

function record(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("Invalid core collection object");
	return Object.fromEntries(Object.entries(value));
}

function positiveInteger(value: unknown): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)
		throw new Error("Invalid core collection identifier");
	return value;
}

function parseProject(value: unknown): CollectionProject {
	const project = record(value);
	if (project.environment !== "test" && project.environment !== "production")
		throw new Error("Invalid core collection environment");
	const projectId = positiveInteger(project.projectId);
	const instanceId = positiveInteger(project.instanceId);
	const projectRef = `${instanceId}-${project.environment === "test" ? "test" : "prod"}`;
	if (project.projectRef !== projectRef)
		throw new Error("Invalid core collection project reference");
	return { projectId, instanceId, projectRef, environment: project.environment };
}

function parsePage(value: unknown): { items: unknown[]; nextCursor: number; hasMore: boolean } {
	const page = record(value);
	if (
		!Array.isArray(page.items) ||
		page.items.length > 100 ||
		typeof page.nextCursor !== "number" ||
		!Number.isSafeInteger(page.nextCursor) ||
		page.nextCursor < 0 ||
		typeof page.hasMore !== "boolean"
	)
		throw new Error("Invalid core collection page");
	return { items: page.items, nextCursor: page.nextCursor, hasMore: page.hasMore };
}

export async function consumeCoreCollection(
	env: CollectionReader & { DB: D1Database },
	pluginId: string,
	consume: (item: CollectedEvent) => Promise<boolean>,
	eventNames: readonly string[] = [],
): Promise<{ consumed: number; failedProjects: number }> {
	const directory = await collectionCursor(env.DB, pluginId, 0);
	const projects = await fetchCollectionProjects(env, pluginId, directory);
	const selected = projects.items.slice(0, 10);
	let consumed = 0;
	let failedProjects = 0;
	for (const project of selected) {
		await checkpointPluginTask();
		try {
			const cursor = await collectionCursor(env.DB, pluginId, project.projectId);
			const page = await fetchCollectionPage(env, pluginId, project.projectId, cursor, eventNames);
			let previous = cursor;
			for (const item of page.items) {
				if (
					item.project.projectId !== project.projectId ||
					!Number.isSafeInteger(item.sequence) ||
					item.sequence <= previous
				)
					throw new Error("Invalid core collection sequence");
				if (!(await consume(item))) {
					failedProjects++;
					break;
				}
				await checkpointPluginTask();
				await env.DB.prepare(
					`INSERT INTO core_collection_cursors(consumer,project_id,last_sequence) VALUES (?,?,?) ON CONFLICT(consumer,project_id) DO UPDATE SET last_sequence=MAX(last_sequence,excluded.last_sequence)`,
				)
					.bind(pluginId, project.projectId, item.sequence)
					.run();
				previous = item.sequence;
				consumed++;
			}
		} catch (error) {
			failedProjects++;
			console.error("[core-collection] consumer failed", {
				pluginId,
				projectId: project.projectId,
				error,
			});
		}
	}
	const nextProject =
		projects.hasMore || projects.items.length > selected.length
			? (selected.at(-1)?.projectId ?? directory)
			: 0;
	await env.DB.prepare(
		`INSERT INTO core_collection_cursors(consumer,project_id,last_sequence) VALUES (?,0,?) ON CONFLICT(consumer,project_id) DO UPDATE SET last_sequence=excluded.last_sequence`,
	)
		.bind(pluginId, nextProject)
		.run();
	return { consumed, failedProjects };
}

async function collectionCursor(
	db: D1Database,
	consumer: string,
	projectId: number,
): Promise<number> {
	const row = await db
		.prepare("SELECT last_sequence FROM core_collection_cursors WHERE consumer=? AND project_id=?")
		.bind(consumer, projectId)
		.first<{ last_sequence: number }>();
	return row?.last_sequence ?? 0;
}
