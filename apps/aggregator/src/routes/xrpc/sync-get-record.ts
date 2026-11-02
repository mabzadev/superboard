import { isDid } from "@atcute/lexicons/syntax";
import { NSID } from "@emdash-cms/registry-lexicons";

import {
	ACTIVE_PROJECTION_JOINS_SQL,
	ACTIVE_PROJECTION_POLICY_SQL,
	ACTIVE_PROFILE_SQL,
	ACTIVE_PROFILE_REDACTION_SQL,
	ACTIVE_PUBLIC_PACKAGE_SQL,
	ACTIVE_PUBLIC_RELEASE_SQL,
	ACTIVE_RELEASE_REDACTION_SQL,
	ALLOWLIST_PROFILE_SQL,
	activeProjectionPolicyBindings,
	activePublicSubjectBindings,
	getListingPolicy,
	packageProfileUri,
	type ListingPolicyConfig,
} from "../../listing-policy.js";

const CAR_CONTENT_TYPE = "application/vnd.ipld.car";

interface ParsedQuery {
	did: string;
	collection: string;
	rkey: string;
}

export async function syncGetRecord(env: Env, request: Request): Promise<Response> {
	if (request.method !== "GET" && request.method !== "HEAD") {
		return jsonError(405, "MethodNotAllowed", "method not allowed", { allow: "GET, HEAD" });
	}
	const parseResult = parseQuery(request);
	if ("error" in parseResult) return parseResult.error;
	const { did, collection, rkey } = parseResult;
	const policy = await getListingPolicy(env);

	const carBytes = await fetchRecordBlob(env, policy, did, collection, rkey);
	if (!carBytes) {
		return jsonError(
			404,
			"RecordNotFound",
			`record not found for (${did}, ${collection}, ${rkey})`,
		);
	}
	const body = carBytes instanceof Uint8Array ? carBytes : new Uint8Array(carBytes);
	return new Response(request.method === "HEAD" ? null : body, {
		status: 200,
		headers: {
			"content-type": CAR_CONTENT_TYPE,
			"content-length": String(body.byteLength),
			"cache-control": "private, no-store",
		},
	});
}

function parseQuery(request: Request): ParsedQuery | { error: Response } {
	const url = new URL(request.url);
	const did = url.searchParams.get("did");
	const collection = url.searchParams.get("collection");
	const rkey = url.searchParams.get("rkey");
	if (!did || !collection || !rkey) {
		return {
			error: jsonError(400, "InvalidRequest", "missing required param: did, collection, rkey"),
		};
	}
	if (!isDid(did)) {
		return { error: jsonError(400, "InvalidRequest", `invalid did: ${did}`) };
	}
	return { did, collection, rkey };
}

async function fetchRecordBlob(
	env: Env,
	policy: ListingPolicyConfig,
	did: string,
	collection: string,
	rkey: string,
): Promise<ArrayBuffer | Uint8Array | null> {
	const session = env.DB.withSession(
		policy.mode === "open" ? "first-unconstrained" : "first-primary",
	);
	switch (collection) {
		case NSID.packageProfile: {
			if (policy.mode === "projection") {
				return selectBlob(
					session,
					`SELECT p.record_blob
					 FROM public_projection_state projection_state
					 ${ACTIVE_PROJECTION_JOINS_SQL}
					 JOIN public_packages p ON p.generation = projection_state.active_generation
					 WHERE projection_state.id = 1
					   AND ${ACTIVE_PROJECTION_POLICY_SQL}
					   AND ${ACTIVE_PUBLIC_PACKAGE_SQL}
					   AND p.did = ? AND p.slug = ?`,
					[
						...activeProjectionPolicyBindings(policy),
						...activePublicSubjectBindings(policy),
						did,
						rkey,
					],
				);
			}
			if (policy.mode === "allowlist" && !policy.allowlist.has(packageProfileUri(did, rkey))) {
				return null;
			}
			return selectBlob(
				session,
				`SELECT p.record_blob FROM packages p
				 WHERE p.did = ? AND p.slug = ?
				   AND ${ACTIVE_PROFILE_SQL}
				   AND ${ACTIVE_PROFILE_REDACTION_SQL}`,
				[did, rkey],
			);
		}
		case NSID.packageRelease:
			if (policy.mode === "projection") {
				return selectBlob(
					session,
					`SELECT r.record_blob
					 FROM public_projection_state projection_state
					 ${ACTIVE_PROJECTION_JOINS_SQL}
					 JOIN public_releases r ON r.generation = projection_state.active_generation
					 JOIN public_packages p
					   ON p.generation = r.generation AND p.did = r.did AND p.slug = r.package
					 WHERE projection_state.id = 1
					   AND ${ACTIVE_PROJECTION_POLICY_SQL}
					   AND ${ACTIVE_PUBLIC_RELEASE_SQL}
					   AND ${ACTIVE_RELEASE_REDACTION_SQL}
					   AND r.did = ? AND r.rkey = ?`,
					[
						...activeProjectionPolicyBindings(policy),
						...activePublicSubjectBindings(policy),
						did,
						rkey,
					],
				);
			}
			if (policy.mode === "allowlist") {
				return selectBlob(
					session,
					`SELECT r.record_blob
					 FROM releases r
					 JOIN packages p ON p.did = r.did AND p.slug = r.package
						 WHERE r.did = ? AND r.rkey = ? AND r.tombstoned_at IS NULL
						   AND ${ACTIVE_PROFILE_SQL}
						   AND ${ACTIVE_PROFILE_REDACTION_SQL}
						   AND ${ALLOWLIST_PROFILE_SQL}
						   AND ${ACTIVE_RELEASE_REDACTION_SQL}`,
					[did, rkey, policy.allowlistJson],
				);
			}
			return selectBlob(
				session,
				`SELECT r.record_blob FROM releases r
				 JOIN packages p ON p.did = r.did AND p.slug = r.package
				 WHERE r.did = ? AND r.rkey = ? AND r.tombstoned_at IS NULL
				   AND ${ACTIVE_PROFILE_SQL}
				   AND ${ACTIVE_PROFILE_REDACTION_SQL}
				   AND ${ACTIVE_RELEASE_REDACTION_SQL}`,
				[did, rkey],
			);
		case NSID.publisherProfile:
			if (rkey !== "self") return null;
			return selectBlob(session, `SELECT record_blob FROM publishers WHERE did = ?`, [did]);
		case NSID.publisherVerification:
			return selectBlob(
				session,
				`SELECT record_blob FROM publisher_verifications WHERE issuer_did = ? AND rkey = ? AND tombstoned_at IS NULL`,
				[did, rkey],
			);
		default:
			return null;
	}
}

async function selectBlob(
	session: D1DatabaseSession,
	sql: string,
	bindings: unknown[],
): Promise<ArrayBuffer | Uint8Array | null> {
	const row = await session
		.prepare(sql)
		.bind(...bindings)
		.first<{ record_blob: ArrayBuffer | Uint8Array }>();
	return row?.record_blob ?? null;
}

function jsonError(
	status: number,
	error: string,
	message: string,
	headers: Record<string, string> = {},
): Response {
	return new Response(JSON.stringify({ error, message }), {
		status,
		headers: { "content-type": "application/json", ...headers },
	});
}
