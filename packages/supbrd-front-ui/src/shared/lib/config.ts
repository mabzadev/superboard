import { useFrontContext } from "@superboard/front-ui/context";
const localUrl = (path: string) => {
	if (typeof window === "undefined") return path;
	return path === "/" ? window.location.origin : new URL(path, window.location.origin).href;
};

export const config = {
	apiUrl: "",
	authUrl: "",
	apiPath: "/api/v1",
	clientId: "superboard-site",
	get docsUrl() {
		return localUrl("/docs");
	},

	supportEmail: null,
} as const;

export function usePublicConfig() {
	const { publicEndpoints: endpoints = {}, locale } = useFrontContext();
	return {
		apiUrl: endpoints.api,
		authUrl: endpoints.auth,
		sdkUrl: endpoints.sdk,
		shortlinkUrl: endpoints.shortlinks,
		filesUrl: endpoints.files,
		mcpUrl: endpoints.mcp,
		siteUrl: endpoints.site,
		docsUrl: endpoints.site ? `${endpoints.site}/docs` : undefined,
		endpointError: (service: string) =>
			locale === "fr"
				? `L’adresse publique ${service} n’est pas configurée.`
				: `${service} endpoint is not configured`,
	};
}
