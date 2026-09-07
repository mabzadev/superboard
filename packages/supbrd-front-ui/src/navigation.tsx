import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";

interface NavigationState {
	path: string;
	parameters: Record<string, string>;
}
const NavigationContext = createContext<NavigationState | null>(null);
const subscribe = (listener: () => void) => {
	globalThis.addEventListener?.("popstate", listener);
	return () => globalThis.removeEventListener?.("popstate", listener);
};
const readSearch = () => globalThis.location?.search ?? "";
const readPath = () => globalThis.location?.pathname ?? "/";

export function NavigationProvider({
	path,
	parameters,
	children,
}: NavigationState & { children: ReactNode }) {
	const value = useMemo(() => ({ path, parameters }), [path, parameters]);
	return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}

export function useParams<T extends Record<string, string> = Record<string, string>>(): T {
	const context = useContext(NavigationContext);
	if (!context) throw new Error("Route parameters are unavailable outside the Front router");
	return context.parameters as T;
}

export function usePathname() {
	const context = useContext(NavigationContext);
	return useSyncExternalStore(subscribe, readPath, () => context?.path ?? "/");
}

export function useSearchParams() {
	const value = useSyncExternalStore(subscribe, readSearch, () => "");
	return useMemo(() => new URLSearchParams(value), [value]);
}

export function useSelectedLayoutSegments() {
	return usePathname().split("/").filter(Boolean);
}
export function useSelectedLayoutSegment() {
	return useSelectedLayoutSegments().at(-1) ?? null;
}

export function useRouter() {
	return useMemo(
		() => ({
			back: () => globalThis.history?.back(),
			forward: () => globalThis.history?.forward(),
			prefetch: async (_href: string) => undefined,
			push: (href: string, _options?: { scroll?: boolean }) => navigate(href, false),
			replace: (href: string, _options?: { scroll?: boolean }) => navigate(href, true),
			refresh: () => globalThis.location?.reload(),
		}),
		[],
	);
}

export function redirect(href: string): never {
	navigate(href, true);
	throw new Error(`REDIRECT:${href}`);
}
export function notFound(): never {
	throw new Error("NOT_FOUND");
}

function navigate(href: string, replace: boolean) {
	if (!globalThis.location) return;
	const url = new URL(href, globalThis.location.href);
	if (url.protocol !== "https:" && url.protocol !== "http:")
		throw new Error("Invalid navigation URL");
	if (url.origin !== globalThis.location.origin || url.pathname !== globalThis.location.pathname) {
		if (replace) globalThis.location.replace(url);
		else globalThis.location.assign(url);
		return;
	}
	globalThis.history[replace ? "replaceState" : "pushState"]({}, "", url);
	globalThis.dispatchEvent(new PopStateEvent("popstate"));
}
