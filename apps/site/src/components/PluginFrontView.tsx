import { useFrontContext, type PluginViewProps } from "@superboard/front-ui/context";
import { useProjectSelection } from "@superboard/front-ui/context/useProjectSelection.js";
import { Component, lazy, Suspense, useMemo, type ReactNode } from "react";

import type { NativeFrontPresentationProjection } from "../lib/native-front-presentation.js";
import { loadPluginClientView } from "../lib/plugin-client-catalog.js";
import { useFrontRuntimeState } from "./FrontRuntimeProviders.js";

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
	const { projectScope: scope } = useFrontContext();
	const { scopeError, requiresScope } = useFrontRuntimeState();
	const { ready, selectedProject } = useProjectSelection();
	const View = useMemo(
		() =>
			lazy(async () => {
				const { Page, Providers } = await loadPluginClientView(pluginId, routeId);
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
	if (!mount || !projection.plugin_lock.some(({ plugin_id }) => plugin_id === pluginId))
		return <p role="alert">{message("site.front.not_found")}</p>;
	if (scopeError)
		return (
			<section role="alert">
				<h2>{message("site.front.error")}</h2>
				<p>{scopeError}</p>
			</section>
		);
	if (requiresScope && (!scope || ready === false))
		return <p role="status">{message("site.front.loading")}</p>;
	const locale = projection.locale;
	const parameters = { ...mount.parameters, lang: locale };
	const props = { path: projection.path, parameters, locale };
	return (
		<ViewBoundary
			key={`${pluginId}:${routeId}:${selectedProject?.id ?? "instance"}`}
			message={message}
		>
			<Suspense fallback={<p role="status">{message("site.front.loading")}</p>}>
				<View {...props} />
			</Suspense>
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
