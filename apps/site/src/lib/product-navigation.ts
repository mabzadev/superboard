import type {
	NativeFrontNavigationGroup,
	NativeFrontNavigationItem,
} from "./native-front-presentation.js";

const suffixPattern = /[?#]/u;
const pathname = (href: string) => href.split(suffixPattern, 1)[0] ?? "";
const queryOf = (href: string) => {
	const parameters = new URL(href, "https://superboard.invalid").searchParams;
	parameters.delete("lang");
	return parameters;
};
/**
 * Entries sharing a pathname are told apart by their query: an entry whose parameters are all
 * present in the current URL wins, the most specific first (e.g. Environment settings › API keys
 * on `/auth/settings?tab=security&section=keys`); otherwise the least specific entry wins.
 */
const queryRank = (href: string, current: URLSearchParams) => {
	const parameters = queryOf(href);
	const satisfied = [...parameters].every(([name, value]) => current.get(name) === value);
	return satisfied ? parameters.size + 1 : -parameters.size;
};
const matchesPath = (path: string, href: string) => {
	const current = pathname(path);
	const target = pathname(href);
	return current === target || (target !== "/" && current.startsWith(`${target}/`));
};

export function organizeProductNavigation(
	input: readonly NativeFrontNavigationGroup[],
	path: string,
) {
	const groups = input.filter(({ items }) => items.length > 0);
	const candidates: Array<{ item: NativeFrontNavigationItem; root: NativeFrontNavigationItem }> =
		[];
	const visit = (items: readonly NativeFrontNavigationItem[], root?: NativeFrontNavigationItem) => {
		for (const item of items) {
			candidates.push({ item, root: root ?? item });
			visit(item.children ?? [], root ?? item);
		}
	};
	for (const group of groups) visit(group.items);
	const current = queryOf(path);
	const active = candidates
		.filter(({ item }) => matchesPath(path, item.href))
		.toSorted(
			(a, b) =>
				pathname(b.item.href).length - pathname(a.item.href).length ||
				queryRank(b.item.href, current) - queryRank(a.item.href, current) ||
				Number(Boolean(a.item.children?.length)) - Number(Boolean(b.item.children?.length)),
		)[0];
	const localItems = active?.root.children?.length
		? candidates
				.filter(({ root, item }) => root === active.root && !item.children?.length)
				.map(({ item }) => item)
		: [];
	return { groups, localItems, activeHref: active?.root.href, activeItem: active?.item };
}
