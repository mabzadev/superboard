import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";

export interface CodeBlockLanguage {
	id: string;
	label: MessageDescriptor;
	aliases?: string[];
}

export const CODE_BLOCK_LANGUAGES: readonly CodeBlockLanguage[] = [
	{ id: "plaintext", label: msg`Plain text`, aliases: ["text", "plain", "txt"] },
	{ id: "astro", label: msg`Astro` },
	{ id: "bash", label: msg`Bash`, aliases: ["sh", "shell", "zsh"] },
	{ id: "c", label: msg`C` },
	{ id: "cpp", label: msg`C++`, aliases: ["c++"] },
	{ id: "csharp", label: msg`C#`, aliases: ["cs", "c#"] },
	{ id: "css", label: msg`CSS` },
	{ id: "diff", label: msg`Diff`, aliases: ["patch"] },
	{ id: "dockerfile", label: msg`Dockerfile`, aliases: ["docker"] },
	{ id: "go", label: msg`Go`, aliases: ["golang"] },
	{ id: "graphql", label: msg`GraphQL`, aliases: ["gql"] },
	{ id: "html", label: msg`HTML` },
	{ id: "java", label: msg`Java` },
	{ id: "javascript", label: msg`JavaScript`, aliases: ["js"] },
	{ id: "json", label: msg`JSON` },
	{ id: "jsx", label: msg`JSX` },
	{ id: "kotlin", label: msg`Kotlin`, aliases: ["kt"] },
	{ id: "lua", label: msg`Lua` },
	{ id: "markdown", label: msg`Markdown`, aliases: ["md"] },
	{ id: "mdx", label: msg`MDX` },
	{ id: "php", label: msg`PHP` },
	{ id: "python", label: msg`Python`, aliases: ["py"] },
	{ id: "ruby", label: msg`Ruby`, aliases: ["rb"] },
	{ id: "rust", label: msg`Rust`, aliases: ["rs"] },
	{ id: "scss", label: msg`SCSS`, aliases: ["sass"] },
	{ id: "sql", label: msg`SQL` },
	{ id: "svelte", label: msg`Svelte` },
	{ id: "swift", label: msg`Swift` },
	{ id: "toml", label: msg`TOML` },
	{ id: "tsx", label: msg`TSX` },
	{ id: "typescript", label: msg`TypeScript`, aliases: ["ts"] },
	{ id: "vue", label: msg`Vue` },
	{ id: "xml", label: msg`XML` },
	{ id: "yaml", label: msg`YAML`, aliases: ["yml"] },
	{ id: "zig", label: msg`Zig` },
];

export function findLanguage(value: string | null | undefined): CodeBlockLanguage | null {
	if (!value) return null;
	const searchText = value.trim().toLowerCase();
	if (!searchText) return null;
	for (const lang of CODE_BLOCK_LANGUAGES) {
		if (lang.id === searchText) return lang;
		if (lang.aliases?.includes(searchText)) return lang;
	}
	return null;
}

const DISALLOWED_CHARS_RE = /[^a-z0-9_-]+/g;
const LEADING_TRAILING_HYPHENS_RE = /^-+|-+$/g;

export function normalizeLanguage(value: string | null | undefined): string | undefined {
	if (!value) return undefined;
	const trimmed = value.trim();
	if (!trimmed) return undefined;
	const match = findLanguage(trimmed);
	if (match) return match.id;
	const sanitized = trimmed
		.toLowerCase()
		.replace(DISALLOWED_CHARS_RE, "-")
		.replace(LEADING_TRAILING_HYPHENS_RE, "");
	return sanitized || undefined;
}

export function languageLabelDescriptor(
	value: string | null | undefined,
): MessageDescriptor | string {
	if (!value) return msg`Plain text`;
	const match = findLanguage(value);
	if (match) return match.label;
	return value;
}
