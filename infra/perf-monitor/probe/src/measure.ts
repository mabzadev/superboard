export interface MeasureRequest {
	targetUrl: string;
	routes: Array<{ path: string; label: string }>;
	warmRequests: number;
}

export type ServerTimings = Record<string, { dur: number; desc?: string }>;

export interface RouteResult {
	path: string;
	label: string;
	coldTtfbMs: number;
	warmTtfbMs: number | null;
	p95TtfbMs: number | null;
	statusCode: number;
	cfColo: string | null;
	cfPlacement: string | null;
	coldServerTimings: ServerTimings | null;
	warmServerTimings: ServerTimings | null;
}

export interface MeasureResponse {
	results: RouteResult[];
	probeRegion: string;
}

export function parseServerTiming(header: string | null): ServerTimings | null {
	if (!header) return null;
	const out: ServerTimings = {};
	for (const rawEntry of header.split(",")) {
		const parts = rawEntry.split(";").map((p) => p.trim());
		const name = parts[0];
		if (!name) continue;
		const entry: { dur: number; desc?: string } = { dur: 0 };
		let sawDur = false;
		for (const param of parts.slice(1)) {
			const eq = param.indexOf("=");
			if (eq === -1) continue;
			const key = param.slice(0, eq).trim();
			let value = param.slice(eq + 1).trim();
			if (value.startsWith('"') && value.endsWith('"')) {
				value = value.slice(1, -1);
			}
			if (key === "dur") {
				const n = Number(value);
				if (Number.isFinite(n)) {
					entry.dur = n;
					sawDur = true;
				}
			} else if (key === "desc") {
				entry.desc = value;
			}
		}
		if (sawDur) out[name] = entry;
	}
	return Object.keys(out).length > 0 ? out : null;
}

async function measureTtfb(url: string): Promise<{
	ttfbMs: number;
	statusCode: number;
	cfColo: string | null;
	cfPlacement: string | null;
	serverTimings: ServerTimings | null;
}> {
	const start = performance.now();
	const response = await fetch(url, {
		method: "GET",
		headers: {
			"User-Agent": "emdash-perf-probe/1.0",
			"Cache-Control": "no-cache",
		},
		redirect: "follow",
	});
	const ttfbMs = performance.now() - start;

	await response.arrayBuffer();

	const cfRay = response.headers.get("cf-ray");
	const cfColo = cfRay?.split("-").pop() ?? null;
	const cfPlacement = response.headers.get("cf-placement");
	const serverTimings = parseServerTiming(response.headers.get("server-timing"));

	return { ttfbMs, statusCode: response.status, cfColo, cfPlacement, serverTimings };
}

function median(values: number[]): number {
	const sorted = values.toSorted((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	if (sorted.length % 2 === 0) {
		return (sorted[mid - 1]! + sorted[mid]!) / 2;
	}
	return sorted[mid]!;
}

function p95(values: number[]): number {
	const sorted = values.toSorted((a, b) => a - b);
	const idx = Math.ceil(sorted.length * 0.95) - 1;
	return sorted[Math.max(0, idx)]!;
}

export async function measureRoutes(req: MeasureRequest): Promise<RouteResult[]> {
	const results: RouteResult[] = [];

	for (const route of req.routes) {
		const url = `${req.targetUrl}${route.path}`;

		const coldUrl = url + (url.includes("?") ? "&" : "?") + `_perf_cold=${Date.now()}`;
		const cold = await measureTtfb(coldUrl);

		const warmTimings: number[] = [];
		const warmMetricSamples: Record<string, { durs: number[]; desc?: string }> = {};
		let lastStatusCode = cold.statusCode;
		for (let i = 0; i < req.warmRequests; i++) {
			const warm = await measureTtfb(url);
			warmTimings.push(warm.ttfbMs);
			lastStatusCode = warm.statusCode;
			if (warm.serverTimings) {
				for (const [name, entry] of Object.entries(warm.serverTimings)) {
					const acc = warmMetricSamples[name] ?? { durs: [], desc: entry.desc };
					acc.durs.push(entry.dur);
					if (!acc.desc && entry.desc) acc.desc = entry.desc;
					warmMetricSamples[name] = acc;
				}
			}
		}

		const warmServerTimings: ServerTimings | null = Object.keys(warmMetricSamples).length
			? Object.fromEntries(
					Object.entries(warmMetricSamples).map(([name, { durs, desc }]) => {
						const entry: { dur: number; desc?: string } = {
							dur: Math.round(median(durs) * 100) / 100,
						};
						if (desc) entry.desc = desc;
						return [name, entry];
					}),
				)
			: null;

		const hasWarm = warmTimings.length > 0;
		const warmTtfbMs = hasWarm ? Math.round(median(warmTimings) * 100) / 100 : null;
		const p95TtfbMs = hasWarm ? Math.round(p95(warmTimings) * 100) / 100 : null;

		results.push({
			path: route.path,
			label: route.label,
			coldTtfbMs: Math.round(cold.ttfbMs * 100) / 100,
			warmTtfbMs,
			p95TtfbMs,
			statusCode: lastStatusCode,
			cfColo: cold.cfColo,
			cfPlacement: cold.cfPlacement,
			coldServerTimings: cold.serverTimings,
			warmServerTimings,
		});
	}

	return results;
}
