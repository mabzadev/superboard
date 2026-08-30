import type { AnchorHTMLAttributes, ReactNode } from "react";

type Href = string | { pathname?: string; query?: Record<string, string | number | undefined> };

export default function Link({
	href,
	children,
	...props
}: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { href: Href; children?: ReactNode }) {
	return (
		<a href={serializeHref(href)} {...props}>
			{children}
		</a>
	);
}

function serializeHref(href: Href) {
	if (typeof href === "string") return href;
	const query = new URLSearchParams();
	for (const [key, value] of Object.entries(href.query ?? {})) {
		if (value !== undefined) query.set(key, String(value));
	}
	const serialized = query.toString();
	return `${href.pathname ?? "/"}${serialized ? `?${serialized}` : ""}`;
}
