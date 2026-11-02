const WHITESPACE_RE = /\s+/;
const DOUBLE_QUOTE_RE = /"/g;
const GLOB_SPECIAL_RE = /[[\]*?]/g;

export function buildFtsPrefixMatch(input: string): string {
	const terms = input
		.trim()
		.split(WHITESPACE_RE)
		.map((term) => term.replace(DOUBLE_QUOTE_RE, '""'))
		.filter((term) => term.length > 0);

	if (terms.length === 0) return "";
	return terms.map((term) => `"${term}"*`).join(" ");
}

export function buildSlugGlobPrefix(input: string): string {
	const escaped = input
		.trim()
		.toLowerCase()
		.replace(GLOB_SPECIAL_RE, (c) => `[${c}]`);
	return `${escaped}*`;
}
