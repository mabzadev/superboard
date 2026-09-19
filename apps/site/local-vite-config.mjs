export function localSiteServerOptions(stateDirectory) {
	return stateDirectory ? { allowedHosts: ["site.internal"] } : undefined;
}
