import type { EmDashConfig } from "../astro/integration/runtime.js";
import type {
	AuthDescriptor,
	AuthProviderDescriptor,
	AuthRouteDescriptor,
	AuthResult,
	ExternalAuthConfig,
} from "./types.js";

export type {
	AuthDescriptor,
	AuthProviderDescriptor,
	AuthRouteDescriptor,
	AuthResult,
	ExternalAuthConfig,
};

export interface PasskeyAuthMode {
	type: "passkey";
}

export interface ExternalAuthMode {
	type: "external";
	providerType: string;
	entrypoint: string;
	config: unknown;
}

export type AuthMode = PasskeyAuthMode | ExternalAuthMode;

export interface EmDashConfigWithAuth extends EmDashConfig {
	auth?: AuthDescriptor;
}

export function getAuthMode(
	config: (EmDashConfig & { auth?: AuthDescriptor }) | null | undefined,
): AuthMode {
	const auth = config?.auth;

	if (auth && "entrypoint" in auth && auth.entrypoint) {
		return {
			type: "external",
			providerType: auth.type,
			entrypoint: auth.entrypoint,
			config: auth.config,
		};
	}

	return { type: "passkey" };
}

export function isExternalAuthEnabled(
	config: (EmDashConfig & { auth?: AuthDescriptor }) | null | undefined,
): boolean {
	return getAuthMode(config).type === "external";
}

export function getExternalAuthConfig(
	config: (EmDashConfig & { auth?: AuthDescriptor }) | null | undefined,
): ExternalAuthMode | null {
	const mode = getAuthMode(config);
	if (mode.type === "external") {
		return mode;
	}
	return null;
}
