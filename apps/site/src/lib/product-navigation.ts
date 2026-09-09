import type {
	NativeFrontNavigationGroup,
	NativeFrontNavigationItem,
} from "./native-front-presentation.js";

const suffixPattern = /[?#]/u;
const matchesPath = (path: string, href: string) => {
	const target = href.split(suffixPattern, 1)[0];
	return (
		target !== undefined && (path === target || (target !== "/" && path.startsWith(`${target}/`)))
	);
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
	const active = candidates
		.filter(({ item }) => matchesPath(path, item.href))
		.toSorted(
			(a, b) =>
				b.item.href.length - a.item.href.length ||
				Number(Boolean(a.item.children?.length)) - Number(Boolean(b.item.children?.length)),
		)[0];
	const localItems = active?.root.children?.length
		? candidates
				.filter(({ root, item }) => root === active.root && !item.children?.length)
				.map(({ item }) => item)
		: [];
	return { groups, localItems, activeHref: active?.root.href, activeItem: active?.item };
}
