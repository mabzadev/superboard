import type { FrontRouteDescriptor, FrontRouteManifest } from "./contracts.js";

const QUERY_OR_FRAGMENT_PATTERN = /[?#]/u;
const ENCODED_PATH_SEPARATOR_PATTERN = /%(?:2f|5c)/iu;
const TRAILING_SLASH_PATTERN = /\/+$/u;
const INTEGER_PATTERN = /^(?:0|-?[1-9][0-9]*)$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export type FrontRouteResolution =
	| {
			result: "matched";
			normalized_path: string;
			route_id: string;
			parameters: Record<string, string>;
			route: FrontRouteDescriptor;
	  }
	| { result: "not_found"; normalized_path: string }
	| { result: "invalid_path"; normalized_path: null };

interface MatchedRoute {
	route: FrontRouteDescriptor;
	parameters: Record<string, string>;
	staticSegments: number;
	dynamicSegments: number;
	catchAllSegments: number;
}

export function resolveFrontRoute(
	manifest: FrontRouteManifest,
	requestedPath: string,
): FrontRouteResolution {
	const normalizedPath = normalizeFrontPath(requestedPath, manifest.normalization);
	if (normalizedPath === null) return { result: "invalid_path", normalized_path: null };

	const matches = manifest.routes
		.map((route) => matchRoute(route, normalizedPath))
		.filter((match): match is MatchedRoute => match !== null)
		.toSorted(compareMatchedRoutes);
	const winner = matches[0];
	if (!winner) return { result: "not_found", normalized_path: normalizedPath };

	return {
		result: "matched",
		normalized_path: normalizedPath,
		route_id: winner.route.route_id,
		parameters: winner.parameters,
		route: winner.route,
	};
}

function normalizeFrontPath(
	requestedPath: string,
	policy: FrontRouteManifest["normalization"],
): string | null {
	const pathOnly = requestedPath.split(QUERY_OR_FRAGMENT_PATTERN, 1)[0] ?? "";
	if (
		!pathOnly.startsWith("/") ||
		ENCODED_PATH_SEPARATOR_PATTERN.test(pathOnly) ||
		pathOnly.includes("\\")
	) {
		return null;
	}
	let decoded: string;
	try {
		decoded = pathOnly
			.split("/")
			.map((segment) => decodeURIComponent(segment))
			.join("/");
	} catch {
		return null;
	}
	if (
		decoded.includes("\0") ||
		decoded.split("/").some((segment) => segment === "." || segment === "..")
	) {
		return null;
	}
	let normalized = decoded.normalize(policy.unicode);
	if (!policy.case_sensitive) normalized = normalized.toLocaleLowerCase("en-US");
	if (policy.trailing_slash === "strip" && normalized.length > 1) {
		normalized = normalized.replace(TRAILING_SLASH_PATTERN, "");
	}
	return normalized || "/";
}

function matchRoute(route: FrontRouteDescriptor, normalizedPath: string): MatchedRoute | null {
	const pathSegments = splitPath(normalizedPath);
	const patternSegments = splitPath(route.path_pattern);
	const parameters: Record<string, string> = {};
	let pathIndex = 0;
	let staticSegments = 0;
	let dynamicSegments = 0;
	let catchAllSegments = 0;

	for (let patternIndex = 0; patternIndex < patternSegments.length; patternIndex += 1) {
		const patternSegment = patternSegments[patternIndex]!;
		if (!patternSegment.startsWith(":")) {
			if (pathSegments[pathIndex] !== patternSegment) return null;
			pathIndex += 1;
			staticSegments += 1;
			continue;
		}

		const parameterName = patternSegment.slice(1);
		const contract = route.parameters[parameterName];
		if (!contract) return null;
		if (contract.type === "path") {
			if (patternIndex !== patternSegments.length - 1) return null;
			const rest = pathSegments.slice(pathIndex).join("/");
			if (contract.required && !rest) return null;
			parameters[parameterName] = rest;
			pathIndex = pathSegments.length;
			catchAllSegments += 1;
			continue;
		}

		const value = pathSegments[pathIndex];
		if (value === undefined) return null;
		if (!matchesParameterContract(value, contract.type)) return null;
		parameters[parameterName] = value;
		pathIndex += 1;
		dynamicSegments += 1;
	}

	if (pathIndex !== pathSegments.length) return null;
	return { route, parameters, staticSegments, dynamicSegments, catchAllSegments };
}

function compareMatchedRoutes(left: MatchedRoute, right: MatchedRoute): number {
	return (
		left.catchAllSegments - right.catchAllSegments ||
		left.dynamicSegments - right.dynamicSegments ||
		right.staticSegments - left.staticSegments ||
		right.route.priority - left.route.priority ||
		left.route.route_id.localeCompare(right.route.route_id)
	);
}

function matchesParameterContract(value: string, type: string): boolean {
	switch (type) {
		case "integer":
			return INTEGER_PATTERN.test(value);
		case "uuid":
			return UUID_PATTERN.test(value);
		case "slug":
			return SLUG_PATTERN.test(value);
		case "string":
			return value.length > 0;
		default:
			return false;
	}
}

function splitPath(path: string): string[] {
	return path === "/" ? [] : path.slice(1).split("/");
}
