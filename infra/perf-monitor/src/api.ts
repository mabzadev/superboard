import { runMeasurements } from "./measure.js";
import {
	DEFAULT_SITE_ID,
	getSite,
	REGIONS,
	REGION_LABELS,
	SITES,
	TARGET_ROUTES,
} from "./routes.js";
import {
	queryResults,
	getLatestResults,
	getRollingMedians,
	getDailyMedians,
	getDeployResults,
	insertResults,
	type Source,
} from "./store.js";

export async function handleApi(request: Request, url: URL, env: Env): Promise<Response | null> {
	const path = url.pathname;

	if (path === "/api/results" && request.method === "GET") {
		return handleResults(url, env);
	}
	if (path === "/api/summary" && request.method === "GET") {
		return handleSummary(url, env);
	}
	if (path === "/api/chart" && request.method === "GET") {
		return handleChart(url, env);
	}
	if (path === "/api/config" && request.method === "GET") {
		return handleConfig();
	}
	if (path === "/api/trigger" && request.method === "POST") {
		return handleTrigger(request, env);
	}

	return null;
}

function parseSource(raw: string | null): Source | undefined {
	if (raw === "deploy" || raw === "cron" || raw === "manual") return raw;
	return undefined;
}

function parseSiteParam(raw: string | null): string {
	if (raw && getSite(raw)) return raw;
	return DEFAULT_SITE_ID;
}

async function handleResults(url: URL, env: Env): Promise<Response> {
	const source = parseSource(url.searchParams.get("source"));
	const siteParam = url.searchParams.get("site");
	const site = siteParam && getSite(siteParam) ? siteParam : undefined;

	const results = await queryResults(env.DB, {
		route: url.searchParams.get("route") ?? undefined,
		region: url.searchParams.get("region") ?? undefined,
		source,
		site,
		since: url.searchParams.get("since") ?? undefined,
		limit: url.searchParams.has("limit") ? parseInt(url.searchParams.get("limit")!, 10) : undefined,
	});

	return Response.json({ results });
}

async function handleSummary(url: URL, env: Env): Promise<Response> {
	const site = parseSiteParam(url.searchParams.get("site"));

	const [latest, medians] = await Promise.all([
		getLatestResults(env.DB, site),
		getRollingMedians(env.DB, site),
	]);

	return Response.json({
		site,
		latest,
		medians,
		config: {
			sites: SITES.map((s) => ({ id: s.id, label: s.label, targetUrl: s.targetUrl })),
			routes: TARGET_ROUTES,
			regions: REGIONS.map((r) => ({ id: r, label: REGION_LABELS[r] })),
		},
	});
}

async function handleChart(url: URL, env: Env): Promise<Response> {
	const route = url.searchParams.get("route");
	const region = url.searchParams.get("region");

	if (!route || !region) {
		return Response.json({ error: "route and region are required" }, { status: 400 });
	}

	const site = parseSiteParam(url.searchParams.get("site"));
	const since = url.searchParams.get("since") ?? undefined;

	if (url.searchParams.get("bucket") === "day") {
		const series = await getDailyMedians(env.DB, { route, region, site, since });
		return Response.json({
			route,
			region,
			site,
			data: series.map((d) => ({
				timestamp: `${d.day} 12:00:00`,
				coldTtfbMs: d.median_cold,
				warmTtfbMs: d.median_warm,
				p95TtfbMs: d.median_p95,
			})),
			deployMarkers: [],
		});
	}

	const limit = url.searchParams.has("limit") ? parseInt(url.searchParams.get("limit")!, 10) : 200;

	const [results, deployResults] = await Promise.all([
		queryResults(env.DB, { route, region, site, since, limit }),
		getDeployResults(env.DB, site, since),
	]);

	const graphResults = results.filter((r) => r.source !== "manual").toReversed();

	const seenShas = new Set<string>();
	const deployMarkers = deployResults
		.filter((r) => {
			if (!r.sha) return false;
			if (r.route !== route || r.region !== region) return false;
			if (seenShas.has(r.sha)) return false;
			seenShas.add(r.sha);
			return true;
		})
		.map((r) => ({
			timestamp: r.timestamp,
			prNumber: r.pr_number,
			sha: r.sha,
			coldTtfbMs: r.cold_ttfb_ms,
		}));

	return Response.json({
		route,
		region,
		site,
		data: graphResults.map((r) => ({
			timestamp: r.timestamp,
			coldTtfbMs: r.cold_ttfb_ms,
			warmTtfbMs: r.warm_ttfb_ms,
			p95TtfbMs: r.p95_ttfb_ms,
			source: r.source,
			sha: r.sha,
			prNumber: r.pr_number,
		})),
		deployMarkers,
	});
}

async function handleConfig(): Promise<Response> {
	return Response.json({
		sites: SITES.map((s) => ({ id: s.id, label: s.label, targetUrl: s.targetUrl })),
		defaultSite: DEFAULT_SITE_ID,
		routes: TARGET_ROUTES,
		regions: REGIONS.map((r) => ({ id: r, label: REGION_LABELS[r] })),
	});
}

const SHA_RE = /^[a-f0-9]{7,40}$/i;

async function handleTrigger(request: Request, env: Env): Promise<Response> {
	let body: {
		note?: unknown;
		sha?: unknown;
		prNumber?: unknown;
		ephemeral?: unknown;
		site?: unknown;
	} = {};
	const contentLength = request.headers.get("content-length");
	if (contentLength && contentLength !== "0") {
		try {
			body = await request.json();
		} catch {
			return Response.json({ error: "invalid JSON body" }, { status: 400 });
		}
	}

	const note = typeof body.note === "string" && body.note.trim() !== "" ? body.note.trim() : null;
	const sha = typeof body.sha === "string" && SHA_RE.test(body.sha) ? body.sha : null;
	const prNumber =
		typeof body.prNumber === "number" && Number.isInteger(body.prNumber) && body.prNumber > 0
			? body.prNumber
			: null;
	const ephemeral = body.ephemeral === true;

	let sites = SITES;
	if (typeof body.site === "string") {
		const match = getSite(body.site);
		if (!match) {
			return Response.json(
				{ error: `unknown site "${body.site}"; valid: ${SITES.map((s) => s.id).join(", ")}` },
				{ status: 400 },
			);
		}
		sites = [match];
	}

	const started = Date.now();
	const results = await runMeasurements(env, { source: "manual", sha, prNumber, note, sites });

	if (results.length === 0) {
		return Response.json({ error: "no measurements returned from probes" }, { status: 502 });
	}

	if (!ephemeral) {
		await insertResults(env.DB, results);
	}

	return Response.json({
		inserted: ephemeral ? 0 : results.length,
		ephemeral,
		durationMs: Date.now() - started,
		note,
		sha,
		prNumber,
		sites: sites.map((s) => s.id),
		results: results.map((r) => ({
			site: r.site,
			route: r.route,
			region: r.region,
			coldTtfbMs: r.coldTtfbMs,
			warmTtfbMs: r.warmTtfbMs,
			p95TtfbMs: r.p95TtfbMs,
			cfColo: r.cfColo,
			coldServerTimings: r.coldServerTimings,
			warmServerTimings: r.warmServerTimings,
		})),
	});
}
