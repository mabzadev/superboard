import { useRouter, useSearchParams } from "@superboard/front-ui/navigation";

/**
 * In-page tab kept in `?tab=`. An absent or unknown value falls back to the
 * tab chosen by the route (`initialTab`). Selecting a tab navigates to the
 * workspace's canonical `path` (the current path by default) and preserves
 * every other query parameter. The first tab is omitted from the URL, unless
 * the rendering route starts elsewhere and would otherwise reopen its own tab.
 */
export function useTabParam<T extends string>(
	tabs: readonly T[],
	{ initialTab, path }: { initialTab: T; path?: string },
) {
	const router = useRouter();
	const search = useSearchParams();
	const tab = tabs.find((value) => value === search.get("tab")) ?? initialTab;
	const selectTab = (value: string) => {
		const next = tabs.find((item) => item === value);
		if (!next || !globalThis.location) return;
		const url = new URL(globalThis.location.href);
		if (path) url.pathname = path;
		if (next === tabs[0] && initialTab === tabs[0]) url.searchParams.delete("tab");
		else url.searchParams.set("tab", next);
		router.push(`${url.pathname}${url.search}`);
	};
	return [tab, selectTab] as const;
}
