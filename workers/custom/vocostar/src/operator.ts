import { listJobs, retryProjectJob } from "./jobs.js";

const pathPattern =
	/^\/internal\/v1\/operator\/projects\/([a-zA-Z0-9_-]+)\/(jobs|voices|conversions|outputs)(?:\/([a-zA-Z0-9._:-]+)\/retry)?$/u;

export async function handleVocostarOperator(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);
	const match = pathPattern.exec(url.pathname);
	if (!match) return Response.json({ error: "not_found" }, { status: 404 });
	const [, projectRef, resource, jobId] = match;
	if (jobId && request.method === "POST" && resource === "jobs")
		return Response.json({ data: await retryProjectJob(jobId, projectRef, env) });
	if (request.method !== "GET" || jobId)
		return Response.json({ error: "method_not_allowed" }, { status: 405 });
	if (resource === "voices") url.searchParams.set("capability", "vocostar.voice.clone");
	if (resource === "conversions" || resource === "outputs")
		url.searchParams.set("capability", "vocostar.media.convert");
	if (resource === "outputs") url.searchParams.set("status", "completed");
	const result = await listJobs(url, env, undefined, projectRef);
	const items = await Promise.all(
		result.jobs.map(async (job) => {
			if (resource !== "outputs") return job;
			const row = await env.VOCOSTAR_DB.prepare("SELECT output FROM users_medias WHERE id = ?")
				.bind(job.entityId)
				.first<{ output: string | null }>();
			return { ...job, output: row?.output ?? null };
		}),
	);
	return Response.json(
		{ data: { items, next_cursor: result.nextCursor } },
		{ headers: { "Cache-Control": "no-store" } },
	);
}
