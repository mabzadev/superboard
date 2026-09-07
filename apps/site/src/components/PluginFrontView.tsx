import type { OperatorProjectScope } from "@superboard/contracts/site-operator";
import { FrontContextProvider, type PluginViewProps } from "@superboard/front-ui/context";
import { NavigationProvider } from "@superboard/front-ui/navigation";
import { QueryClient, QueryClientProvider } from "@superboard/front-ui/query";
import { Toaster } from "@superboard/front-ui/toaster";
import {
	Component,
	lazy,
	Suspense,
	useEffect,
	useMemo,
	useState,
	type ComponentType,
	type ReactNode,
} from "react";

import { ProjectSelectionProvider } from "../../../../packages/supbrd-front-ui/src/shared/context/useProjectSelection.js";
import type { NativeFrontPresentationProjection } from "../lib/native-front-presentation.js";
import { parseOperatorProjectScopeResponse } from "../lib/operator-project-scope-response.js";

interface PluginClientModule {
	pluginId: string;
	views: Record<string, () => Promise<{ default: ComponentType<PluginViewProps> }>>;
	Providers?: ComponentType<PluginViewProps & { children: ReactNode }>;
}

const modules = import.meta.glob<PluginClientModule>(
	"../../../../packages/supbrd-runtime-plugins/src/front/client/plugins/*/index.ts",
);
const byPlugin = new Map(
	Object.entries(modules).map(([path, load]) => [path.split("/").at(-2), load]),
);

export function PluginFrontView({
	projection,
	message,
}: {
	projection: NativeFrontPresentationProjection;
	message(id: string): string;
}) {
	const mount = projection.content_mounts[0];
	const pluginId = mount?.renderer.plugin_id ?? "";
	const routeId = mount?.route_id ?? "";
	const [scope, setScope] = useState<OperatorProjectScope | null>(projection.project_scope ?? null);
	const [scopeError, setScopeError] = useState<string | null>(null);
	const [queryClient] = useState(
		() =>
			new QueryClient({
				defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
			}),
	);
	const requiresScope =
		Boolean(projection.operator) &&
		!new Set(["superboard.profile", "superboard.account"]).has(routeId);
	const View = useMemo(
		() =>
			lazy(async () => {
				const load = byPlugin.get(pluginId);
				if (!load) throw new Error(`Plugin client unavailable: ${pluginId}`);
				const plugin = await load();
				if (plugin.pluginId !== pluginId) throw new Error("Plugin client ownership mismatch");
				const loadView = plugin.views[routeId];
				if (!loadView) throw new Error(`View is not registered by ${pluginId}: ${routeId}`);
				const module = await loadView();
				const Providers = plugin.Providers;
				const Page = module.default;
				return {
					default: (props: PluginViewProps) =>
						Providers ? (
							<Providers {...props}>
								<Page {...props} />
							</Providers>
						) : (
							<Page {...props} />
						),
				};
			}),
		[pluginId, routeId],
	);
	useEffect(() => {
		if (!requiresScope || scope) return;
		const controller = new AbortController();
		void fetch("/_emdash/api/superboard/operator-context", {
			method: "POST",
			credentials: "same-origin",
			signal: controller.signal,
			headers: {
				"Content-Type": "application/json",
				"X-EmDash-Request": "1",
				"Idempotency-Key": crypto.randomUUID(),
			},
			body: "{}",
		})
			.then(async (response) => {
				setScope(await parseOperatorProjectScopeResponse(response));
				return undefined;
			})
			.catch((error) => {
				if (!controller.signal.aborted)
					setScopeError(error instanceof Error ? error.message : "Operator context is unavailable");
			});
		return () => controller.abort();
	}, [requiresScope, scope]);
	if (!mount || !projection.plugin_lock.some(({ plugin_id }) => plugin_id === pluginId))
		return <p role="alert">{message("site.front.not_found")}</p>;
	if (scopeError)
		return (
			<section role="alert">
				<h2>{message("site.front.error")}</h2>
				<p>{scopeError}</p>
			</section>
		);
	if (requiresScope && !scope) return <p role="status">{message("site.front.loading")}</p>;
	const parameters = { lang: projection.locale, ...mount.parameters };
	const props = { path: projection.path, parameters, locale: projection.locale };
	return (
		<ViewBoundary key={`${pluginId}:${routeId}`} message={message}>
			<FrontContextProvider
				value={{
					...props,
					instanceId: projection.instance_id,
					pluginId,
					operator: projection.operator ?? null,
					projectScope: scope,
					activePluginIds: projection.plugin_lock.map(({ plugin_id }) => plugin_id),
				}}
			>
				<NavigationProvider path={projection.path} parameters={parameters}>
					<QueryClientProvider client={queryClient}>
						<ProjectSelectionProvider>
							<Suspense fallback={<p role="status">{message("site.front.loading")}</p>}>
								<View {...props} />
							</Suspense>
							<Toaster />
						</ProjectSelectionProvider>
					</QueryClientProvider>
				</NavigationProvider>
			</FrontContextProvider>
		</ViewBoundary>
	);
}

class ViewBoundary extends Component<
	{ message(id: string): string; children: ReactNode },
	{ error: Error | null }
> {
	override state = { error: null as Error | null };
	static getDerivedStateFromError(error: Error) {
		return { error };
	}
	override render() {
		return this.state.error ? (
			<section role="alert">
				<h2>{this.props.message("site.front.error")}</h2>
				<p>{this.state.error.message}</p>
			</section>
		) : (
			this.props.children
		);
	}
}
