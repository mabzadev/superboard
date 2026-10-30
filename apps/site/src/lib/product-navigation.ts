import type {
	NativeFrontNavigationGroup,
	NativeFrontNavigationItem,
} from "./native-front-presentation.js";

const suffixPattern = /[?#]/u;
const pathname = (href: string) => href.split(suffixPattern, 1)[0] ?? "";
const querySpecificity = (href: string) => {
	const parameters = new URL(href, "https://superboard.invalid").searchParams;
	parameters.delete("lang");
	return parameters.size;
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
	const active = candidates
		.filter(({ item }) => matchesPath(path, item.href))
		.toSorted(
			(a, b) =>
				pathname(b.item.href).length - pathname(a.item.href).length ||
				querySpecificity(a.item.href) - querySpecificity(b.item.href) ||
				Number(Boolean(a.item.children?.length)) - Number(Boolean(b.item.children?.length)),
		)[0];
	const localItems = active?.root.children?.length
		? candidates
				.filter(({ root, item }) => root === active.root && !item.children?.length)
				.map(({ item }) => item)
		: [];
	return { groups, localItems, activeHref: active?.root.href, activeItem: active?.item };
}
