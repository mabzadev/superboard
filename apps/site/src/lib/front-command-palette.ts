import { canonicalFrontHref } from "@superboard/contracts/front-paths";

import type { FrontRecentPage } from "./front-recent-pages.js";
import type {
	NativeFrontNavigationGroup,
	NativeFrontNavigationItem,
} from "./native-front-presentation.js";

export type FrontCommandGroup = "recent" | "actions" | "pages";

export interface FrontCommand {
	id: string;
	group: FrontCommandGroup;
	label: string;
	hint?: string;
	keywords?: string;
	href?: string;
	target?: string;
	run?: () => void;
}

const GROUP_ORDER: readonly FrontCommandGroup[] = ["recent", "actions", "pages"];
const DIACRITICS = /\p{M}/gu;
const SEPARATORS = /[\s›/·,.:_-]+/u;
const SUFFIX = /[?#]/u;
const identity = ({ href, label }: FrontCommand) => `${href}\n${label}`;

function normalizeCommandText(value: string) {
	return value.normalize("NFD").replace(DIACRITICS, "").toLowerCase().trim();
}

export function commandPathname(href: string) {
	return canonicalFrontHref(href).split(SUFFIX, 1)[0] ?? "";
}

export function menuDestination(
	commands: readonly FrontCommand[],
	pathname: string,
	parameters: Record<string, string> = {},
): string | undefined {
	const page = commands.find(
		(command) =>
			command.group === "pages" && command.href && commandPathname(command.href) === pathname,
	);
	if (!page?.href) return undefined;
	const url = new URL(page.href, "https://superboard.invalid");
	for (const [name, value] of Object.entries(parameters)) url.searchParams.set(name, value);
	return url.href.slice(url.origin.length);
}

export function navigationCommands(groups: readonly NativeFrontNavigationGroup[]): FrontCommand[] {
	const commands: FrontCommand[] = [];
	const seen = new Set<string>();
	const add = (item: NativeFrontNavigationItem, trail: readonly string[]) => {
		const hint = trail.join(" › ");
		const key = `${canonicalFrontHref(item.href)}\n${item.label}`;
		if (!seen.has(key) && item.label) {
			seen.add(key);
			commands.push({
				id: `page:${commands.length}:${item.href}`,
				group: "pages",
				label: item.label,
				...(hint ? { hint } : {}),
				href: item.href,
				...(item.target ? { target: item.target } : {}),
			});
		}
		for (const child of item.children ?? []) add(child, [...trail, item.label]);
	};
	for (const group of groups) {
		const direct = group.direct === true && group.items.length === 1;
		for (const item of group.items)
			add(item, direct || item.label === group.label ? [] : [group.label]);
	}
	return commands;
}

export function recentCommands(
	pages: readonly FrontRecentPage[],
	currentHref: string | undefined,
): FrontCommand[] {
	const current = currentHref ? canonicalFrontHref(currentHref) : undefined;
	return pages
		.filter(({ href }) => canonicalFrontHref(href) !== current)
		.slice(0, 5)
		.map((page, index) => ({
			id: `recent:${index}:${page.href}`,
			group: "recent",
			label: page.label,
			...(page.hint ? { hint: page.hint } : {}),
			href: page.href,
		}));
}

export function scoreCommand(command: FrontCommand, query: string) {
	const needle = normalizeCommandText(query);
	if (!needle) return 1;
	const label = normalizeCommandText(command.label);
	const haystack = normalizeCommandText(
		[command.label, command.hint, command.keywords].filter(Boolean).join(" "),
	);
	const words = haystack.split(SEPARATORS);
	let score = 0;
	for (const token of needle.split(SEPARATORS).filter(Boolean)) {
		if (words.some((word) => word.startsWith(token))) score += 2;
		else if (haystack.includes(token)) score += 1;
		else return 0;
	}
	if (label === needle) score += 8;
	else if (label.startsWith(needle)) score += 4;
	return score;
}

export function filterCommands(commands: readonly FrontCommand[], query: string): FrontCommand[] {
	const searching = normalizeCommandText(query) !== "";
	const actions = new Set(
		commands.filter((command) => command.group === "actions" && command.href).map(identity),
	);
	const ranked = commands
		.filter((command) => !(searching && command.group === "recent"))
		.filter((command) => !(command.group === "pages" && actions.has(identity(command))))
		.map((command, index) => ({ command, index, score: scoreCommand(command, query) }))
		.filter(({ score }) => score > 0);
	return ranked
		.toSorted(
			(a, b) =>
				GROUP_ORDER.indexOf(a.command.group) - GROUP_ORDER.indexOf(b.command.group) ||
				b.score - a.score ||
				a.index - b.index,
		)
		.map(({ command }) => command);
}
