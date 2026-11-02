const PARAM_PATTERN = /\[(\w+)\]/g;

const SPLAT_PATTERN = /\[\.\.\.(\w+)\]/g;

const ANY_PLACEHOLDER = /\[(?:\.\.\.)?(\w+)\]/g;

const NESTED_BRACKETS = /\[[^\]]*\[/;

const EMPTY_BRACKETS = /\[\]/;

const OPEN_BRACKET = /\[/g;

const CLOSE_BRACKET = /\]/g;

const CAPTURE_GROUP_SPLIT = /(\([^)]+\))/;

const REGEX_SPECIAL_CHARS = /[.*+?^${}|\\]/g;

export interface CompiledPattern {
	regex: RegExp;
	paramNames: string[];
	source: string;
}

export function isPattern(source: string): boolean {
	return source.match(ANY_PLACEHOLDER) !== null;
}

export function validatePattern(source: string): string | null {
	if (!source.startsWith("/")) {
		return "Pattern must start with /";
	}

	if (NESTED_BRACKETS.test(source)) {
		return "Nested brackets are not allowed";
	}

	if (EMPTY_BRACKETS.test(source)) {
		return "Empty brackets are not allowed";
	}

	const openCount = (source.match(OPEN_BRACKET) ?? []).length;
	const closeCount = (source.match(CLOSE_BRACKET) ?? []).length;
	if (openCount !== closeCount) {
		return "Unmatched brackets";
	}

	const segments = source.split("/").filter(Boolean);
	for (let i = 0; i < segments.length; i++) {
		const segment = segments[i];
		if (SPLAT_PATTERN.test(segment) && i !== segments.length - 1) {
			SPLAT_PATTERN.lastIndex = 0;
			return "Catch-all [...param] must be in the last segment";
		}
		SPLAT_PATTERN.lastIndex = 0;
	}

	for (const segment of segments) {
		const placeholders = segment.match(ANY_PLACEHOLDER);
		if (placeholders && placeholders.length > 1) {
			return "Each segment can contain at most one placeholder";
		}
		if (placeholders && placeholders[0] !== segment) {
			return "A placeholder must be the entire segment, not mixed with literal text";
		}
	}

	const names: string[] = [];
	for (const m of source.matchAll(ANY_PLACEHOLDER)) {
		const name = m[1];
		if (names.includes(name)) {
			return `Duplicate parameter name: ${name}`;
		}
		names.push(name);
	}

	return null;
}

export function validateDestinationParams(source: string, destination: string): string | null {
	const sourceNames = new Set<string>();
	for (const m of source.matchAll(ANY_PLACEHOLDER)) {
		sourceNames.add(m[1]);
	}

	for (const m of destination.matchAll(ANY_PLACEHOLDER)) {
		const name = m[1];
		if (!sourceNames.has(name)) {
			return `Destination references [${name}] which is not captured in the source pattern`;
		}
	}

	return null;
}

export function compilePattern(source: string): CompiledPattern {
	const paramNames: string[] = [];

	let regexStr = source.replace(SPLAT_PATTERN, (_match, name: string) => {
		paramNames.push(name);
		return "(.+)";
	});

	regexStr = regexStr.replace(PARAM_PATTERN, (_match, name: string) => {
		paramNames.push(name);
		return "([^/]+)";
	});

	const parts = regexStr.split(CAPTURE_GROUP_SPLIT);
	const escaped = parts
		.map((part, i) => {
			if (i % 2 === 1) return part;
			return part.replace(REGEX_SPECIAL_CHARS, "\\$&");
		})
		.join("");

	return {
		regex: new RegExp(`^${escaped}$`),
		paramNames,
		source,
	};
}

export function matchPattern(
	compiled: CompiledPattern,
	path: string,
): Record<string, string> | null {
	const match = path.match(compiled.regex);
	if (!match) return null;

	const params: Record<string, string> = {};
	for (let i = 0; i < compiled.paramNames.length; i++) {
		const value = match[i + 1];
		if (value !== undefined) {
			params[compiled.paramNames[i]] = value;
		}
	}
	return params;
}

export function interpolateDestination(
	destination: string,
	params: Record<string, string>,
): string {
	let result = destination.replace(SPLAT_PATTERN, (_match, name: string) => {
		return params[name] ?? "";
	});

	result = result.replace(PARAM_PATTERN, (_match, name: string) => {
		return params[name] ?? "";
	});

	return result;
}
