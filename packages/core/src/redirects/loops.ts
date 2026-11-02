import {
	compilePattern,
	matchPattern,
	interpolateDestination,
	type CompiledPattern,
} from "./patterns.js";

export interface RedirectEdge {
	id: string;
	source: string;
	destination: string;
	enabled: boolean;
	isPattern: boolean;
}

interface CompiledPatternRedirect {
	id: string;
	compiled: CompiledPattern;
	destination: string;
}

function compilePatterns(edges: RedirectEdge[]): CompiledPatternRedirect[] {
	const result: CompiledPatternRedirect[] = [];
	for (const edge of edges) {
		if (edge.enabled && edge.isPattern) {
			result.push({
				id: edge.id,
				compiled: compilePattern(edge.source),
				destination: edge.destination,
			});
		}
	}
	return result;
}

const DUMMY_SEGMENT = "__p__";

const SPLAT_RE = /\[\.\.\.(\w+)\]/g;

const PARAM_RE = /\[(\w+)\]/g;

function extractPatternSuffix(patternSource: string): string {
	let result = patternSource.replace(SPLAT_RE, DUMMY_SEGMENT);
	SPLAT_RE.lastIndex = 0;
	result = result.replace(PARAM_RE, DUMMY_SEGMENT);
	const parts = result.split("/").filter(Boolean);
	return parts.slice(1).join("/");
}

function generateRepresentatives(template: string, existingEdges?: RedirectEdge[]): string[] {
	const hasSplat = SPLAT_RE.test(template);
	SPLAT_RE.lastIndex = 0;

	if (hasSplat) {
		const splatIndex = template.indexOf("[...");
		const prefix = template.slice(0, splatIndex);

		const reps = [
			template.replace(SPLAT_RE, DUMMY_SEGMENT).replace(PARAM_RE, DUMMY_SEGMENT),
			template
				.replace(SPLAT_RE, `${DUMMY_SEGMENT}/${DUMMY_SEGMENT}`)
				.replace(PARAM_RE, DUMMY_SEGMENT),
			template
				.replace(SPLAT_RE, `${DUMMY_SEGMENT}/${DUMMY_SEGMENT}/${DUMMY_SEGMENT}`)
				.replace(PARAM_RE, DUMMY_SEGMENT),
		];

		if (existingEdges) {
			for (const edge of existingEdges) {
				if (edge.enabled && edge.isPattern && edge.source !== template) {
					const suffix = extractPatternSuffix(edge.source);
					if (suffix) {
						reps.push(`${prefix}${suffix}`);
					}
				}
			}
		}

		return reps;
	}

	return [template.replace(PARAM_RE, DUMMY_SEGMENT)];
}

function resolveNext(
	path: string,
	graph: Map<string, { destination: string; id: string }>,
	patterns: CompiledPatternRedirect[],
	edges?: RedirectEdge[],
): { destination: string; id: string } | null {
	const exact = graph.get(path);
	if (exact) return exact;

	if (!path.includes("[")) {
		for (const pr of patterns) {
			const params = matchPattern(pr.compiled, path);
			if (params) {
				const resolved = interpolateDestination(pr.destination, params);
				return { destination: resolved, id: pr.id };
			}
		}
	} else {
		const representatives = generateRepresentatives(path, edges);
		for (const pr of patterns) {
			for (const rep of representatives) {
				const params = matchPattern(pr.compiled, rep);
				if (params) {
					const resolved = interpolateDestination(pr.destination, params);
					return { destination: resolved, id: pr.id };
				}
			}
		}
	}

	return null;
}

function buildGraph(edges: RedirectEdge[]): Map<string, { destination: string; id: string }> {
	const graph = new Map<string, { destination: string; id: string }>();
	for (const edge of edges) {
		if (edge.enabled) {
			graph.set(edge.source, { destination: edge.destination, id: edge.id });
		}
	}
	return graph;
}

export function detectLoops(edges: RedirectEdge[]): string[] {
	const graph = buildGraph(edges);
	const patterns = compilePatterns(edges);
	const visited = new Set<string>();
	const loopRedirectIds = new Set<string>();

	for (const [startSource] of graph) {
		if (visited.has(startSource)) continue;

		const path: string[] = [];
		const pathSet = new Set<string>();
		const pathIds: string[] = [];
		let current: string | undefined = startSource;

		while (current) {
			if (pathSet.has(current)) {
				const loopStart = path.indexOf(current);
				for (const id of pathIds.slice(loopStart)) loopRedirectIds.add(id);
				break;
			}

			if (visited.has(current)) {
				break;
			}

			const next = resolveNext(current, graph, patterns, edges);
			if (!next) break;

			path.push(current);
			pathSet.add(current);
			pathIds.push(next.id);
			current = next.destination;
		}

		for (const node of path) visited.add(node);
	}

	return [...loopRedirectIds];
}

function findMatchingTemplate(
	resolvedPath: string,
	patterns: CompiledPatternRedirect[],
): string | null {
	for (const pr of patterns) {
		if (matchPattern(pr.compiled, resolvedPath) !== null) {
			return pr.compiled.source;
		}
	}
	return null;
}

export function wouldCreateLoop(
	source: string,
	destination: string,
	existingEdges: RedirectEdge[],
	excludeId?: string,
): string[] | null {
	const filtered = excludeId ? existingEdges.filter((e) => e.id !== excludeId) : existingEdges;
	const graph = buildGraph(filtered);
	const patterns = compilePatterns(filtered);

	const sourceIsPattern = source.includes("[");
	const compiledSource = sourceIsPattern ? compilePattern(source) : null;

	let startingPoints: string[];
	if (destination.includes("[")) {
		const reps = generateRepresentatives(destination, filtered);
		const compiled = compilePattern(destination);
		for (const [key] of graph) {
			if (!key.includes("[") && matchPattern(compiled, key) !== null) {
				reps.push(key);
			}
		}
		reps.push(destination);
		startingPoints = reps;
	} else {
		startingPoints = [destination];
	}

	for (const start of startingPoints) {
		const path = [source, destination];
		let current = start;
		const seen = new Set<string>([source, destination, start]);

		// eslint-disable-next-line no-constant-condition -- terminates via return/break when chain ends or cycle found
		while (true) {
			const next = resolveNext(current, graph, patterns, filtered);
			if (!next) break;

			const loopsBack =
				seen.has(next.destination) ||
				(compiledSource !== null && matchPattern(compiledSource, next.destination) !== null);

			if (loopsBack) {
				const displayPath =
					!seen.has(next.destination) && compiledSource !== null ? source : next.destination;
				path.push(displayPath);
				return path;
			}

			const cleanDest = next.destination.includes(DUMMY_SEGMENT)
				? (findMatchingTemplate(next.destination, patterns) ?? next.destination)
				: next.destination;
			path.push(cleanDest);
			seen.add(next.destination);
			current = next.destination;
		}
	}

	return null;
}
