import type { RegistryConfigInput } from "../../registry/types.js";
import type { Storage } from "../../storage/types.js";
import type { StorageDescriptor } from "../storage/types.js";

const S3_ADAPTER_ENTRYPOINT = "emdash/storage/s3";

export function getConfiguredStorageEndpoint(
	storage: StorageDescriptor | undefined,
	runtimeStorage?: Pick<Storage, "getClientUploadOrigin"> | null,
): string | undefined {
	const config = storage?.config;
	if (typeof config === "object" && config !== null && "endpoint" in config) {
		const endpoint = config.endpoint;
		if (typeof endpoint === "string") return endpoint;
	}

	if (storage?.entrypoint === S3_ADAPTER_ENTRYPOINT) {
		const envEndpoint =
			typeof process !== "undefined" && process.env ? process.env.S3_ENDPOINT : undefined;
		if (envEndpoint) return envEndpoint;
	}

	return runtimeStorage?.getClientUploadOrigin?.();
}

function getRegistryAggregatorOrigin(
	registry: RegistryConfigInput | undefined,
): string | undefined {
	const aggregatorUrl = typeof registry === "string" ? registry : registry?.aggregatorUrl;
	if (!aggregatorUrl) return undefined;

	try {
		const url = new URL(aggregatorUrl);
		if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
		return url.origin;
	} catch {
		return undefined;
	}
}

function getHttpOrigin(rawUrl: string | undefined): string | undefined {
	if (!rawUrl) return undefined;

	try {
		const url = new URL(rawUrl);
		if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
		return url.origin;
	} catch {
		return undefined;
	}
}

export function buildEmDashCsp(registry?: RegistryConfigInput, storageEndpoint?: string): string {
	const connectSrc = ["connect-src 'self'"];
	const origins = new Set<string>();
	const registryAggregatorOrigin = getRegistryAggregatorOrigin(registry);
	if (registryAggregatorOrigin) origins.add(registryAggregatorOrigin);
	const storageOrigin = getHttpOrigin(storageEndpoint);
	if (storageOrigin) origins.add(storageOrigin);
	connectSrc.push(...origins);

	return [
		"default-src 'self'",
		"script-src 'self' 'unsafe-inline'",
		"style-src 'self' 'unsafe-inline'",
		connectSrc.join(" "),
		"form-action 'self'",
		"frame-ancestors 'none'",
		"img-src 'self' https: data: blob:",
		"object-src 'none'",
		"base-uri 'self'",
	].join("; ");
}
