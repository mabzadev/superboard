import { canonicalizeReleasePayload } from "./canonical-json.js";
import type { RendererDescriptor } from "./contracts.js";

export interface SuperBoardContributionDescriptor {
	version: string;
	checksum: string;
}

export interface SuperBoardStoreDescriptor extends SuperBoardContributionDescriptor {
	store_id: string;
	kind: "d1";
	authority: string;
	schema_version: string;
	migrations: readonly string[];
	availability: "required" | "optional";
	classification: "public" | "restricted" | "secret";
	encryption: "required";
}

export interface SuperBoardSchemaDescriptor extends SuperBoardContributionDescriptor {
	schema_id: string;
	closed: true;
	json_schema: { readonly [key: string]: unknown };
}

export interface SuperBoardCommandDescriptor extends SuperBoardContributionDescriptor {
	command_id: string;
	audience: string;
	permission: string;
	failure_policy: "fail_closed";
}

export interface SuperBoardDataSourceDescriptor extends SuperBoardContributionDescriptor {
	data_source_id: string;
	audience: string;
	permission: string;
	store_id: string;
	consistency: "strong" | "eventual";
	unavailable_state: "unavailable";
}

export interface SuperBoardPluginManifest {
	schema_version: string;
	plugin_id: string;
	plugin_kind: "full" | "module";
	plugin_version: string;
	artifact_id: string;
	artifact_checksum: string;
	publisher: string;
	execution: {
		backend: "sandboxed" | "native";
		worker: "none" | "dedicated";
		renderer: "native_bundle" | "remote_bundle";
	};
	capabilities: string[];
	aliases: Record<string, string>;
	stores: SuperBoardStoreDescriptor[];
	schemas: SuperBoardSchemaDescriptor[];
	renderers: RendererDescriptor[];
	commands: SuperBoardCommandDescriptor[];
	data_sources: SuperBoardDataSourceDescriptor[];
	failure_policies: { writes: "fail_closed"; reads: "unavailable" };
}

const checksumPattern = /^sha256:[a-f0-9]{64}$/u;

export async function sha256Canonical(value: unknown): Promise<string> {
	const bytes = new TextEncoder().encode(canonicalizeReleasePayload(value));
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export async function verifySuperBoardPluginManifest(
	value: unknown,
	options: { artifact_content?: unknown } = {},
): Promise<{ valid: boolean; errors: string[] }> {
	const errors: string[] = [];
	if (!isRecord(value)) return { valid: false, errors: ["MANIFEST_NOT_OBJECT"] };
	const expectedKeys = [
		"aliases", "artifact_checksum", "artifact_id", "capabilities", "commands", "data_sources",
		"execution", "failure_policies", "plugin_id", "plugin_kind", "plugin_version", "publisher",
		"renderers", "schema_version", "schemas", "stores",
	].toSorted();
	if (JSON.stringify(Object.keys(value).toSorted()) !== JSON.stringify(expectedKeys)) {
		errors.push("MANIFEST_NOT_CLOSED");
	}
	if (typeof value.plugin_id !== "string" || typeof value.plugin_version !== "string") {
		errors.push("PLUGIN_IDENTITY_INVALID");
	}
	if (!isChecksum(value.artifact_checksum)) errors.push("ARTIFACT_CHECKSUM_INVALID");

	const collections = ["stores", "schemas", "renderers", "commands", "data_sources"] as const;
	for (const collectionName of collections) {
		const collection = value[collectionName];
		if (!Array.isArray(collection)) {
			errors.push("CONTRIBUTION_COLLECTION_INVALID");
			continue;
		}
		for (const contribution of collection) {
			if (!isRecord(contribution)) {
				errors.push("CONTRIBUTION_INVALID");
				continue;
			}
			const id = contributionId(contribution);
			if (!id?.startsWith(`${String(value.plugin_id)}.`)) errors.push("CONTRIBUTION_NAMESPACE_INVALID");
			const checksumKey = collectionName === "renderers" ? "build_checksum" : "checksum";
			if (!isChecksum(contribution[checksumKey])) errors.push("CONTRIBUTION_CHECKSUM_INVALID");
			if (collectionName !== "renderers" && isChecksum(contribution.checksum)) {
				const { checksum: _checksum, ...content } = contribution;
				if ((await sha256Canonical(content)) !== contribution.checksum) {
					errors.push("CONTRIBUTION_CHECKSUM_MISMATCH");
				}
			}
		}
	}

	if (isChecksum(value.artifact_checksum)) {
		const { artifact_checksum: _checksum, ...artifact } = value;
		if ((await sha256Canonical(options.artifact_content ?? artifact)) !== value.artifact_checksum) {
			errors.push("ARTIFACT_CHECKSUM_MISMATCH");
		}
	}
	return { valid: errors.length === 0, errors: [...new Set(errors)] };
}

function contributionId(value: Record<string, unknown>): string | null {
	for (const key of ["renderer_id", "command_id", "data_source_id", "schema_id", "store_id"] as const) {
		if (typeof value[key] === "string") return value[key];
	}
	return null;
}

function isChecksum(value: unknown): value is string {
	return typeof value === "string" && checksumPattern.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
