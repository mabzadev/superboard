import { useRouter, useSearchParams } from "@superboard/front-ui/navigation";
import { Alert, AlertDescription } from "@superboard/front-ui/ui/alert.js";
import { useEffect, type ReactNode } from "react";

export function AcquisitionPage({
	title,
	description,
	error,
	children,
}: {
	title: string;
	description: string;
	error?: string | null;
	children: ReactNode;
}) {
	return (
		<section className="ds-page space-y-5">
			<header className="ds-page-header">
				<div>
					<h1 className="ds-page-title">{title}</h1>
					<p className="ds-page-description">{description}</p>
				</div>
			</header>
			{error && (
				<Alert variant="destructive">
					<AlertDescription>{error}</AlertDescription>
				</Alert>
			)}
			{children}
		</section>
	);
}

export function useAcquisitionSelection() {
	const params = useSearchParams();
	const router = useRouter();
	const itemId = params.get("item") ?? "";
	const selectItem = (id: string) => {
		const url = new URL(window.location.href);
		if (id) url.searchParams.set("item", id);
		else url.searchParams.delete("item");
		url.searchParams.delete("section");
		if (exitRegistry) exitRegistry.allowNext = true;
		router.push(url.pathname + url.search);
	};
	return { itemId, selectItem };
}

type ItemExitGuard = { dirty: boolean; message: string; discard: () => void };
type ItemExitRegistry = { guards: Set<ItemExitGuard>; previousUrl: string; allowNext: boolean };
const exitRegistryKey = Symbol.for("superboard.acquisition.item-exit");
const exitRegistry = installItemExitRegistry();

function installItemExitRegistry(): ItemExitRegistry | null {
	if (typeof window === "undefined") return null;
	const scope = globalThis as typeof globalThis & { [exitRegistryKey]?: ItemExitRegistry };
	if (scope[exitRegistryKey]) return scope[exitRegistryKey];
	const registry: ItemExitRegistry = {
		guards: new Set(),
		previousUrl: window.location.href,
		allowNext: false,
	};
	scope[exitRegistryKey] = registry;
	window.addEventListener("beforeunload", (event) => {
		if (![...registry.guards].some((guard) => guard.dirty)) return;
		event.preventDefault();
		event.returnValue = "";
	});
	window.addEventListener(
		"popstate",
		(event) => {
			const previous = new URL(registry.previousUrl);
			const next = new URL(window.location.href);
			const allowed = registry.allowNext;
			registry.allowNext = false;
			if (
				!allowed &&
				(previous.pathname !== next.pathname ||
					previous.searchParams.get("item") !== next.searchParams.get("item"))
			) {
				const dirty = [...registry.guards].filter((guard) => guard.dirty);
				if (dirty.some((guard) => !window.confirm(guard.message))) {
					window.history.pushState(null, "", registry.previousUrl);
					event.stopImmediatePropagation();
					return;
				}
				for (const guard of dirty) guard.discard();
			}
			registry.previousUrl = window.location.href;
		},
		true,
	);
	return registry;
}

export function useItemExitGuard(dirty: boolean, message: string, onDiscard: () => void) {
	useEffect(() => {
		if (!exitRegistry) return;
		exitRegistry.previousUrl = window.location.href;
		const guard = { dirty, message, discard: onDiscard };
		exitRegistry.guards.add(guard);
		return () => {
			exitRegistry.guards.delete(guard);
		};
	}, [dirty, message, onDiscard]);
}
