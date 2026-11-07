import {
	authenticationProviderSecrets,
	validateAuthenticationSettings,
	withoutRetiredAuthenticationSettings,
	type AuthenticationDeploymentStatus,
	type AuthenticationSettingsSnapshot,
} from "@superboard/contracts/authentication-settings";
import { useProjectSelection } from "@superboard/front-ui/context/useProjectSelection.js";
import { useQuery } from "@superboard/front-ui/query";

import { GET } from "./transport.js";

const trailingSlashes = /\/+$/u;

function deploymentStatus(value: unknown): AuthenticationDeploymentStatus | undefined {
	if (!value || typeof value !== "object") return undefined;
	const secrets: unknown = Reflect.get(value, "providerSecrets");
	if (!secrets || typeof secrets !== "object") return undefined;
	const providerSecrets = authenticationProviderSecrets(
		(provider) => Reflect.get(secrets, provider) === true,
	);
	const captchaSecret: unknown = Reflect.get(value, "captchaSecret");
	return typeof captchaSecret === "boolean"
		? { providerSecrets, captchaSecret }
		: { providerSecrets };
}

export function settingsSnapshot(value: unknown): AuthenticationSettingsSnapshot {
	if (
		!value ||
		typeof value !== "object" ||
		!("revision" in value) ||
		typeof value.revision !== "number" ||
		!Number.isSafeInteger(value.revision) ||
		value.revision < 0 ||
		!("values" in value)
	)
		throw new Error("CONFIGURATION_INVALID");
	let serverUrl: string | undefined;
	if ("serverUrl" in value && typeof value.serverUrl === "string") {
		const url = new URL(value.serverUrl);
		if (!["https:", "http:"].includes(url.protocol) || url.username || url.password)
			throw new Error("CONFIGURATION_INVALID");
		serverUrl = url.href.replace(trailingSlashes, "");
	}
	const deployment = "deployment" in value ? deploymentStatus(value.deployment) : undefined;
	return {
		revision: value.revision,
		...(serverUrl ? { serverUrl } : {}),
		...(deployment ? { deployment } : {}),
		values: validateAuthenticationSettings(withoutRetiredAuthenticationSettings(value.values)),
		updatedAt: "updatedAt" in value && typeof value.updatedAt === "string" ? value.updatedAt : null,
	};
}

export function useAuthenticationSettings() {
	const { selectedProject } = useProjectSelection();
	const projectRef = selectedProject?.id;
	const endpoint = `/api/v1/identity-admin/projects/${encodeURIComponent(projectRef ?? "")}/api/v1/configuration`;
	const query = useQuery({
		queryKey: ["authentication-settings", projectRef],
		enabled: Boolean(projectRef),
		refetchOnWindowFocus: false,
		retry: false,
		queryFn: async () => settingsSnapshot((await GET(endpoint)).data),
	});
	return { projectRef, endpoint, query };
}
