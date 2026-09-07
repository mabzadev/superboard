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
	get sdkUrl() {
		return localUrl("/app/libraries");
	},
	get shortlinkUrl() {
		return localUrl("/");
	},
	get mcpUrl() {
		return localUrl("/");
	},
	supportEmail: null,
} as const;
