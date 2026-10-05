import { newTargetManifest } from "./target-template.mjs";

export function installationTarget({ name, domain, email, workersDevSubdomain, installationId }) {
	if (!/^[a-z][a-z0-9-]{1,14}$/u.test(name ?? "")) throw new Error("INSTALLATION_NAME_INVALID");
	if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/u.test(domain ?? ""))
		throw new Error("INSTALLATION_DOMAIN_INVALID");
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email ?? ""))
		throw new Error("INSTALLATION_EMAIL_INVALID");
	if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(installationId ?? ""))
		throw new Error("INSTALLATION_ID_INVALID");
	const targetName = `${name}-${installationId.slice(0, 8)}`;
	const target = newTargetManifest({
		target: targetName,
		selectedEnvironment: "production",
		args: {
			"account-alias": targetName,
			"workers-dev-subdomain": workersDevSubdomain,
			"zone-name": domain,
			"api-domain": `api.${domain}`,
			"auth-domain": `sdk.${domain}`,
			"sdk-domain": `sdk.${domain}`,
			"files-domain": `sdk.${domain}`,
			"shortlinks-domain": `in.${domain}`,
			"site-domain": `board.${domain}`,
			"mcp-domain": `board.${domain}`,
			"mail-from-address": `noreply@${domain}`,
			"operator-email": email,
			"operator-docs-url": "https://github.com/mabzadev/superboard",
			"auth-gateway-issuer": `https://sdk.${domain}`,
			"auth-gateway-audience": `${targetName}.application`,
			"auth-gateway-jwks-url": `https://sdk.${domain}/.well-known/jwks.json`,
			"max-file-bytes": "52428800",
			"allowed-file-content-types": "image/*,audio/*,video/*,application/pdf",
		},
	});
	target.deploymentProfile = "consolidated";
	target.freshInstallation = { id: installationId };
	target.environments.production.publicRouting = "active";
	target.environments.production.supportRouting.mode = "active";
	return target;
}
