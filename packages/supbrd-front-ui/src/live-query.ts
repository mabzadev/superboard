import { QueryClient, QueryClientContext, useQuery } from "@tanstack/react-query";
import { useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";

interface Snapshot<T> {
	value: T;
	etag: string | null;
	checkedAt: string;
}
class AuthorizationError extends Error {}
function subscribeVisibility(listener: () => void) {
	if (typeof document === "undefined") return () => undefined;
	document.addEventListener("visibilitychange", listener);
	return () => { document.removeEventListener("visibilitychange", listener); };
}
function visible() {
	return typeof document === "undefined" || document.visibilityState !== "hidden";
}

export function useLiveQuery<T>(options: {
	key: readonly (string | null | undefined)[];
	url: string;
	parse(response: Response): Promise<T>;
}) {
	const inherited = useContext(QueryClientContext);
	const [fallback] = useState(
		() => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 60000 } } }),
	);
	const client = inherited ?? fallback;
	const encodedKey = options.key.map((value) => value ?? "").join("\0");
	const queryKey = useMemo(() => encodedKey.split("\0"), [encodedKey]);
	const isVisible = useSyncExternalStore(subscribeVisibility, visible, () => true);
	const query = useQuery(
		{
			queryKey,
			queryFn: async ({ signal }): Promise<Snapshot<T>> => {
				const previous = client.getQueryData<Snapshot<T>>(queryKey);
				const response = await fetch(options.url, {
					credentials: "same-origin",
					signal,
					headers: {
						"X-EmDash-Request": "1",
						...(previous?.etag ? { "If-None-Match": previous.etag } : {}),
					},
				});
				if (response.status === 401 || response.status === 403)
					throw new AuthorizationError("OPERATOR_REQUIRED");
				const checkedAt =
					response.headers.get("x-superboard-observed-at") ?? new Date().toISOString();
				if (response.status === 304) {
					if (!previous) throw new Error("CONDITIONAL_RESPONSE_WITHOUT_SNAPSHOT");
					return { ...previous, checkedAt };
				}
				return {
					value: await options.parse(response),
					etag: response.headers.get("etag"),
					checkedAt,
				};
			},
			retry: false,
			refetchInterval: isVisible ? 30000 : false,
			refetchIntervalInBackground: false,
			refetchOnWindowFocus: isVisible,
		},
		client,
	);
	useEffect(() => {
		if (isVisible)
			client.refetchQueries(
				{ queryKey, exact: true, type: "active" },
				{ cancelRefetch: false },
			).catch(() => undefined);
	}, [client, queryKey, isVisible]);
	useEffect(
		() => () => {
			if (!inherited) fallback.clear();
		},
		[fallback, inherited],
	);
	const update = useCallback(
		(updater: (current: T | undefined) => T) => {
			client.setQueryData<Snapshot<T>>(queryKey, (previous) => ({
				value: updater(previous?.value),
				etag: null,
				checkedAt: new Date().toISOString(),
			}));
		},
		[client, queryKey],
	);
	return {
		...query,
		data: query.error instanceof AuthorizationError ? undefined : query.data?.value,
		checkedAt: query.data?.checkedAt,
		update,
	};
}
