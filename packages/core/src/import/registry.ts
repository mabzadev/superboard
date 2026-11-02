import { resolveAndValidateExternalUrl } from "./ssrf.js";
import type { ImportSource, ProbeResult, SourceProbeResult } from "./types.js";

const TRAILING_SLASHES_PATTERN = /\/+$/;

const sources = new Map<string, ImportSource>();

export function registerSource(source: ImportSource): void {
	sources.set(source.id, source);
}

export function getSource(id: string): ImportSource | undefined {
	return sources.get(id);
}

export function getAllSources(): ImportSource[] {
	return [...sources.values()];
}

export function getFileSources(): ImportSource[] {
	return getAllSources().filter((s) => s.requiresFile);
}

export function getUrlSources(): ImportSource[] {
	return getAllSources().filter((s) => s.canProbe);
}

export async function probeUrl(url: string): Promise<ProbeResult> {
	let normalizedUrl = url.trim();
	if (!normalizedUrl.startsWith("http")) {
		normalizedUrl = `https://${normalizedUrl}`;
	}

	normalizedUrl = normalizedUrl.replace(TRAILING_SLASHES_PATTERN, "");

	await resolveAndValidateExternalUrl(normalizedUrl);

	const results: SourceProbeResult[] = [];
	const urlSources = getUrlSources();

	const probePromises = urlSources.map(async (source) => {
		try {
			const result = await source.probe?.(normalizedUrl);
			if (result) {
				return result;
			}
		} catch (error) {
			console.debug(`Probe failed for ${source.id}:`, error);
		}
		return null;
	});

	const probeResults = await Promise.allSettled(probePromises);

	for (const result of probeResults) {
		if (result.status === "fulfilled" && result.value) {
			results.push(result.value);
		}
	}

	const confidenceOrder = { definite: 0, likely: 1, possible: 2 };
	results.sort((a, b) => confidenceOrder[a.confidence] - confidenceOrder[b.confidence]);

	return {
		url: normalizedUrl,
		isWordPress: results.length > 0,
		bestMatch: results[0] ?? null,
		allMatches: results,
	};
}

export function clearSources(): void {
	sources.clear();
}
