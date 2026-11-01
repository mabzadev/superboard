import { useFrontContext, type PluginViewProps } from "@superboard/front-ui/context";
import { useProjectSelection } from "@superboard/front-ui/context/useProjectSelection.js";
import { Component, lazy, memo, Suspense, useMemo, type ReactNode } from "react";

import type { NativeFrontPresentationProjection } from "../lib/native-front-presentation.js";
import { preloadPluginClientView } from "../lib/plugin-client-catalog.js";
import { useFrontRuntimeState } from "./FrontRuntimeProviders.js";

export const PluginFrontView = memo(function PluginFrontView({
	projection,
	message,
}: {
	projection: NativeFrontPresentationProjection;
	message(id: string): string;
}) {
	const mount = projection.content_mounts[0];
	const pluginId = mount?.renderer.plugin_id ?? "";
	const routeId = mount?.route_id ?? "";
	const locked =
		Boolean(mount) && projection.plugin_lock.some(({ plugin_id }) => plugin_id === pluginId);
	const { projectScope: scope } = useFrontContext();
	const { scopeError, requiresScope } = useFrontRuntimeState();
	const { ready, selectedProject } = useProjectSelection();
	// The import starts on the first render, in parallel with the operator scope request,
	// instead of waiting for the scope before the lazy view first renders.
	const View = useMemo(() => {
		if (!locked) return null;
		const view = preloadPluginClientView(pluginId, routeId);
		return lazy(async () => {
			const { Page, Providers } = await view;
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
		});
	}, [locked, pluginId, routeId]);
	if (!mount || !View) return <p role="alert">{message("site.front.not_found")}</p>;
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
});

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
