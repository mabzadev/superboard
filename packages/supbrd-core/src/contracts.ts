import type { CanonicalJsonValue } from "./canonical-json.js";

export const REQUIRED_FRONT_STATES = [
	"loading",
	"empty",
	"forbidden",
	"not_found",
	"error",
	"unavailable",
	"maintenance",
] as const;

export type FrontState = (typeof REQUIRED_FRONT_STATES)[number];
export type FrontStatePolicies = Record<FrontState, string>;
export type FrontRouteKind = "system" | "page" | "redirect";
export type FrontAudience = "system" | "emdash_admin" | "superboard_front";
export type FrontAuthPolicy = "public" | "anonymous_only" | "authenticated";

export interface FrontRouteDescriptor {
	route_id: string;
	path_pattern: string;
	route_kind: FrontRouteKind;
	audience: FrontAudience;
	auth_policy: FrontAuthPolicy;
	permission_expression: string;
	priority: number;
	parameters: Record<
		string,
		{
			type: "string" | "integer" | "uuid" | "slug" | "path";
			required: boolean;
		}
	>;
	query: Record<
		string,
		{
			type: "string" | "integer" | "boolean";
			required: boolean;
		}
	>;
	page_id: string | null;
	layout_ids: string[];
	renderer_ids: string[];
	state_policies: FrontStatePolicies;
	dependencies: string[];
	redirect: { route_id: string; status: 301 | 302 | 307 | 308 } | null;
}

export interface FrontRouteManifestInput {
	schema_version: string;
	manifest_id: string;
	normalization: {
		unicode: "NFC";
		case_sensitive: boolean;
		trailing_slash: "strip" | "preserve";
		percent_decoding: "once";
	};
	auth_transitions: {
		login_route_id: string;
		authenticated_home_route_id: string;
	};
	system_routes: FrontRouteDescriptor[];
	routes: FrontRouteDescriptor[];
}

export interface FrontRouteManifest extends FrontRouteManifestInput {
	route_manifest_checksum: string;
}

export interface GatewayRouteDescriptor {
	route_id: string;
	method: "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS";
	path_pattern: string;
	destination: string;
	auth_policy: "public" | "authenticated";
	audience: string;
	scopes: string[];
	timeout_ms: number;
}

export interface GatewayManifestInput {
	schema_version: string;
	gateway_manifest_id: string;
	routes: GatewayRouteDescriptor[];
}

export interface GatewayManifest extends GatewayManifestInput {
	gateway_checksum: string;
}

export interface PresentationPage {
	page_id: string;
	title: string;
	root_renderer_id: string;
}

export interface PresentationLayout {
	layout_id: string;
	root_renderer_id: string;
}

export interface FrontPresentation {
	pages: PresentationPage[];
	layouts: PresentationLayout[];
	navigation: CanonicalJsonValue[];
	translations: CanonicalJsonValue[];
	media: CanonicalJsonValue[];
	theme: {
		theme_id: string;
		tokens: Record<string, CanonicalJsonValue>;
	};
}

export interface RendererDescriptor {
	renderer_id: string;
	plugin_id: string;
	plugin_version: string;
	build_id: string;
	build_checksum: string;
	abi_version: string;
	runtime_range: string;
	props_schema: {
		schema_id: string;
		version: string;
		checksum: string;
	};
	capabilities: string[];
	slots: string[];
	supported_states: FrontState[];
}

export interface PluginLockEntry {
	plugin_id: string;
	version: string;
	artifact_checksum: string;
	native: boolean;
}

export interface DependencyPolicy {
	dependency_id: string;
	kind: "required" | "optional" | "fallback";
	minimum_version: string;
	activation_policy: "ready" | "degraded";
	runtime_failure_policy: "fail_closed" | "unavailable" | "stale" | "fallback";
	fallback_dependency_id: string | null;
}

export interface FrontReleaseInput {
	schema_version: string;
	compiler_version: string;
	instance_id: string;
	front_draft_id: string;
	draft_snapshot_id: string;
	compilation_id: string;
	candidate_id: string;
	release_id: string;
	release_sequence: number;
	previous_release_id: string | null;
	created_at: string;
	front_route_manifest: FrontRouteManifestInput;
	gateway_manifest: GatewayManifestInput;
	presentation: FrontPresentation;
	renderers: RendererDescriptor[];
	plugin_lock: PluginLockEntry[];
	dependency_policies: DependencyPolicy[];
	rollback: {
		classification:
			| "pointer_only"
			| "store_restore_required"
			| "instance_restore_required"
			| "rollback_forbidden_until_condition";
		restore_point_id: string | null;
		conditions: string[];
	};
	core_concrete_pages: [];
}

export interface FrontReleasePayload extends Omit<
	FrontReleaseInput,
	"front_route_manifest" | "gateway_manifest"
> {
	front_route_manifest: FrontRouteManifest;
	gateway_manifest: GatewayManifest;
}

export interface ReleaseSignature {
	algorithm: "ES256";
	kid: string;
	value: string;
}

export type ValidationLayer =
	| "schema"
	| "normalization"
	| "identity"
	| "reference_graph"
	| "routing"
	| "renderer_compatibility"
	| "actions_data_sources"
	| "permissions_security"
	| "translations_media"
	| "plugins_stores_workers"
	| "migrations"
	| "rollback_readiness"
	| "integrity";

export interface ValidationReceipt {
	receipt_id: string;
	layer: ValidationLayer;
	level: "info" | "warning" | "error";
	status: "passed" | "failed";
	candidate_id: string;
	release_id: string;
	content_checksum: string;
	message: string;
	receipt_checksum: string;
}

export interface CompiledFrontRelease {
	payload: FrontReleasePayload;
	content_checksum: string;
	signature: ReleaseSignature;
	validation_receipts: ValidationReceipt[];
	validation_set_checksum: string;
	verification_status: "verified";
}

export interface ReleaseSigningKey {
	kid: string;
	private_key: CryptoKey;
}

export interface ReleaseVerificationKey {
	kid: string;
	public_key: CryptoKey;
}

export interface FrontReleaseVerification {
	valid: boolean;
	errors: string[];
}
