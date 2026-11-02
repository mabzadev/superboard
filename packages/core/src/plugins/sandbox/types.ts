import type { Kysely } from "kysely";

import type { Database } from "../../database/types.js";
import type { PluginManifest, RequestMeta, UserInfo } from "../types.js";

export interface ResourceLimits {
	cpuMs?: number;
	memoryMb?: number;
	subrequests?: number;
	wallTimeMs?: number;
}

export interface PluginCodeStorage {
	get(path: string): Promise<string | null>;
	exists(path: string): Promise<boolean>;
}

export interface SandboxEmailMessage {
	to: string;
	subject: string;
	text: string;
	html?: string;
}

export type SandboxEmailSendCallback = (
	message: SandboxEmailMessage,
	pluginId: string,
) => Promise<void>;

export interface SandboxOptions {
	storage?: PluginCodeStorage;
	db: Kysely<Database>;
	beforeContentWrite?: () => Promise<void>;
	limits?: ResourceLimits;
	siteInfo?: {
		name: string;
		url: string;
		locale: string;
		trailingSlash?: "always" | "never" | "ignore";
	};
	emailSend?: SandboxEmailSendCallback;
	mediaStorage?: {
		upload(options: { key: string; body: Uint8Array; contentType: string }): Promise<unknown>;
		delete(key: string): Promise<unknown>;
	};
}

export interface SandboxedPluginInstance {
	readonly id: string;

	invokeHook(hookName: string, event: unknown): Promise<unknown>;

	invokeRoute(routeName: string, input: unknown, request: SerializedRequest): Promise<unknown>;

	terminate(): Promise<void>;
}

export interface SerializedRequest {
	url: string;
	method: string;
	headers: Record<string, string>;
	meta: RequestMeta;
	user?: UserInfo;
}

const SANDBOX_ROUTE_ERROR_DEFINITIONS = {
	MEDIA_USAGE_ACTIVATION_IN_PROGRESS: {
		message: "Media usage activation is in progress",
		status: 503,
	},
	MEDIA_USAGE_ACTIVATION_CHECK_FAILED: {
		message: "Unable to verify media usage activation state",
		status: 503,
	},
} as const;

export type SandboxRouteErrorCode = keyof typeof SANDBOX_ROUTE_ERROR_DEFINITIONS;

export interface SandboxRouteErrorDetails {
	code: SandboxRouteErrorCode;
	message: string;
	status: 503;
}

export interface SandboxRouteErrorEnvelope {
	__emdashSandboxRouteError: true;
	error: SandboxRouteErrorDetails;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isSandboxRouteErrorCode(value: unknown): value is SandboxRouteErrorCode {
	return typeof value === "string" && value in SANDBOX_ROUTE_ERROR_DEFINITIONS;
}

export function getSandboxRouteErrorDetails(error: unknown): SandboxRouteErrorDetails | null {
	if (!isRecord(error)) return null;

	const propertyCode = isSandboxRouteErrorCode(error.code) ? error.code : null;
	const nameCode =
		error instanceof Error && isSandboxRouteErrorCode(error.name) ? error.name : null;
	if (propertyCode && nameCode && propertyCode !== nameCode) return null;

	const code = propertyCode ?? nameCode;
	if (!code || (error.status !== undefined && error.status !== 503)) return null;

	return {
		code,
		...SANDBOX_ROUTE_ERROR_DEFINITIONS[code],
	};
}

export function createSandboxRouteError(
	code: SandboxRouteErrorCode,
): Error & SandboxRouteErrorDetails {
	const details: SandboxRouteErrorDetails = {
		code,
		...SANDBOX_ROUTE_ERROR_DEFINITIONS[code],
	};
	return Object.assign(new Error(details.message), details, { name: code });
}

export function createSandboxRouteErrorEnvelope(error: unknown): SandboxRouteErrorEnvelope | null {
	const details = getSandboxRouteErrorDetails(error);
	return details ? { __emdashSandboxRouteError: true, error: details } : null;
}

export function getSandboxRouteErrorEnvelope(value: unknown): SandboxRouteErrorEnvelope | null {
	if (!isRecord(value) || value.__emdashSandboxRouteError !== true) return null;
	const details = getSandboxRouteErrorDetails(value.error);
	return details ? { __emdashSandboxRouteError: true, error: details } : null;
}

export interface SandboxRunner {
	isAvailable(): boolean;

	isHealthy(): boolean;

	load(manifest: PluginManifest, code: string): Promise<SandboxedPluginInstance>;

	setEmailSend(callback: SandboxEmailSendCallback | null): void;

	terminateAll(): Promise<void>;
}

export class SandboxUnavailableError extends Error {
	constructor(pluginId: string, reason: string) {
		super(`Plugin sandbox unavailable for ${pluginId}: ${reason}`);
		this.name = "SandboxUnavailableError";
	}
}

export type SandboxRunnerFactory = (options: SandboxOptions) => SandboxRunner;
