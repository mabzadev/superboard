export function useRouter() {
	return {
		push: (href: string) => window.location.assign(href),
		replace: (href: string) => window.location.replace(href),
		back: () => window.history.back(),
		forward: () => window.history.forward(),
		refresh: () => window.location.reload(),
		prefetch: async () => undefined,
	};
}

export function usePathname() {
	return typeof window === "undefined" ? "/" : window.location.pathname;
}

export function useSearchParams() {
	return new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
}

export function useParams<T extends Record<string, string | string[]>>() {
	const segments =
		typeof window === "undefined" ? [] : window.location.pathname.split("/").filter(Boolean);
	const identityIndex = segments.indexOf("identity");
	const last = segments.at(-1) ?? "";
	return {
		lang: identityIndex >= 0 ? (segments[identityIndex + 1] ?? "en") : "en",
		id: last,
		authId: last,
	} as unknown as T;
}

export function redirect(href: string): never {
	if (typeof window !== "undefined") window.location.replace(href);
	throw new Error(`REDIRECT:${href}`);
}

export function notFound(): never {
	throw new Error("NOT_FOUND");
}
