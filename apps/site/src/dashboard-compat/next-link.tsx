import { forwardRef, type AnchorHTMLAttributes, type MouseEvent } from "react";

type Href = string | URL | { hash?: string; pathname?: string; query?: Record<string, unknown> };

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
	href: Href;
	legacyBehavior?: boolean;
	locale?: string | false;
	onNavigate?: (event: MouseEvent<HTMLAnchorElement>) => void;
	passHref?: boolean;
	prefetch?: boolean | null;
	replace?: boolean;
	scroll?: boolean;
	shallow?: boolean;
};

const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link(
	{
		href,
		legacyBehavior: _legacyBehavior,
		locale: _locale,
		onNavigate,
		passHref: _passHref,
		prefetch: _prefetch,
		replace = false,
		scroll: _scroll,
		shallow: _shallow,
		onClick,
		...props
	},
	ref,
) {
	const resolvedHref = linkHref(href);
	return (
		<a
			{...props}
			ref={ref}
			href={resolvedHref}
			onClick={(event) => {
				onClick?.(event);
				onNavigate?.(event);
				if (!replace || event.defaultPrevented || event.button !== 0) return;
				event.preventDefault();
				const url = new URL(resolvedHref, globalThis.location?.href ?? "http://localhost");
				if (globalThis.location && url.pathname !== globalThis.location.pathname) {
					globalThis.location.replace(url);
					return;
				}
				globalThis.history?.replaceState({}, "", url);
				globalThis.dispatchEvent(new PopStateEvent("popstate"));
			}}
		/>
	);
});

export default Link;

function linkHref(href: Href): string {
	if (typeof href === "string") return href;
	if (href instanceof URL) return href.toString();
	const query = new URLSearchParams();
	for (const [key, value] of Object.entries(href.query ?? {})) {
		const values = Array.isArray(value) ? value : [value];
		for (const item of values) {
			const serialized = queryValue(item);
			if (serialized !== null) query.append(key, serialized);
		}
	}
	const serialized = query.toString();
	return `${href.pathname ?? ""}${serialized ? `?${serialized}` : ""}${href.hash ?? ""}`;
}

function queryValue(value: unknown): string | null {
	if (value === undefined || value === null || typeof value === "symbol") return null;
	if (value instanceof Date) return value.toISOString();
	if (typeof value === "object") return JSON.stringify(value);
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "bigint") return value.toString();
	if (typeof value === "boolean") return value ? "true" : "false";
	return null;
}
