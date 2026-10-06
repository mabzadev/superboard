import { newTargetManifest } from "./target-template.mjs";

export function installationTarget({
	name,
	domain,
	email,
	workersDevSubdomain,
	installationId,
	hostPrefix = "",
}) {
	if (!/^[a-z][a-z0-9-]{1,14}$/u.test(name ?? "")) throw new Error("INSTALLATION_NAME_INVALID");
	if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/u.test(domain ?? ""))
		throw new Error("INSTALLATION_DOMAIN_INVALID");
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email ?? ""))
		throw new Error("INSTALLATION_EMAIL_INVALID");
	if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(installationId ?? ""))
		throw new Error("INSTALLATION_ID_INVALID");
	const targetName = `${name}-${installationId.slice(0, 8)}`;
	if (hostPrefix && !/^[a-z][a-z0-9-]{1,30}$/u.test(hostPrefix))
		throw new Error("INSTALLATION_HOST_PREFIX_INVALID");
	const hostname = (service) => `${hostPrefix ? `${hostPrefix}-` : ""}${service}.${domain}`;
	const target = newTargetManifest({
		target: targetName,
		selectedEnvironment: "production",
		args: {
			"account-alias": targetName,
			"workers-dev-subdomain": workersDevSubdomain,
			"zone-name": domain,
			"api-domain": hostname("api"),
			"auth-domain": hostname("sdk"),
			"sdk-domain": hostname("sdk"),
			"files-domain": hostname("sdk"),
			"shortlinks-domain": hostname("in"),
			"site-domain": hostname("board"),
			"mcp-domain": hostname("board"),
			"mail-from-address": `noreply@${domain}`,
			"operator-email": email,
			"operator-docs-url": "https://github.com/mabzadev/superboard",
			"auth-gateway-issuer": `https://${hostname("sdk")}`,
			"auth-gateway-audience": `${targetName}.application`,
			"auth-gateway-jwks-url": `https://${hostname("sdk")}/.well-known/jwks.json`,
			"max-file-bytes": "52428800",
			"allowed-file-content-types": "image/*,audio/*,video/*,application/pdf",
		},
	});
	target.deploymentProfile = "consolidated";
	target.observabilitySource = "emdash";
	target.freshInstallation = { id: installationId };
	target.environments.production.publicRouting = "active";
	target.environments.production.supportRouting.mode = "active";
	return target;
}
