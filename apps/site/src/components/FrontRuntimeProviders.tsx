import type { OperatorProjectScope } from "@superboard/contracts/site-operator";
import { FrontContextProvider } from "@superboard/front-ui/context";
import { NavigationProvider } from "@superboard/front-ui/navigation";
import { QueryClient, QueryClientProvider } from "@superboard/front-ui/query";
import { ThemeProvider } from "@superboard/front-ui/theme";
import { Toaster } from "@superboard/front-ui/toaster";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { ProjectSelectionProvider } from "../../../../packages/supbrd-front-ui/src/shared/context/useProjectSelection.js";
import type { NativeFrontPresentationProjection } from "../lib/native-front-presentation.js";
import { parseOperatorProjectScopeResponse } from "../lib/operator-project-scope-response.js";

const RuntimeState = createContext({ scopeError: null as string | null, requiresScope: false });
export const useFrontRuntimeState = () => useContext(RuntimeState);

export function FrontRuntimeProviders({
	projection,
	children,
}: {
	projection: NativeFrontPresentationProjection;
	children: ReactNode;
}) {
	const mount = projection.content_mounts[0];
	const pluginId = mount?.renderer.plugin_id ?? "supbrd-core";
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
		pluginId !== "supbrd-core" &&
		!["superboard.profile", "superboard.account"].includes(routeId);
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
	const locale = projection.locale;
	const parameters = { ...mount?.parameters, lang: locale };
	return (
		<ThemeProvider
			attribute={["class", "data-theme"]}
			defaultTheme="system"
			enableSystem
			storageKey={`superboard:${projection.instance_id}:theme`}
			disableTransitionOnChange
		>
			<FrontContextProvider
				value={{
					path: projection.path,
					parameters,
					locale,
					instanceId: projection.instance_id,
					pluginId,
					operator: projection.operator ?? null,
					projectScope: scope,
					activePluginIds: projection.plugin_lock.map((entry) => entry.plugin_id),
					publicEndpoints: projection.public_endpoints,
					deployment: projection.deployment,
					environments: projection.environments,
				}}
			>
				<NavigationProvider path={projection.path} parameters={parameters}>
					<QueryClientProvider client={queryClient}>
						<ProjectSelectionProvider>
							<RuntimeState.Provider value={{ scopeError, requiresScope }}>
								{children}
							</RuntimeState.Provider>
							<Toaster />
						</ProjectSelectionProvider>
					</QueryClientProvider>
				</NavigationProvider>
			</FrontContextProvider>
		</ThemeProvider>
	);
}
