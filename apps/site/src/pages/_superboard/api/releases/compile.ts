import { assertFrontReleaseInput, compileFrontRelease } from "@superboard/supbrd-core";
import type { APIRoute } from "astro";

import { jsonResponse, requireReleaseOperator } from "../../../../lib/operator-guard.js";
import {
	loadDraftSnapshot,
	recordCompilation,
} from "../../../../lib/front-workflow-repository.js";
import { stageCompiledFrontRelease } from "../../../../lib/release-repository.js";
import { getSiteEnv } from "../../../../lib/site-env.js";

export const prerender = false;

interface ReleasePrivateJwk extends JsonWebKey {
	kty: "EC";
	crv: "P-256";
	x: string;
	y: string;
	d: string;
	kid: string;
	alg: "ES256";
}

interface ReleasePublicJwk extends JsonWebKey {
	kid: string;
}

export const POST: APIRoute = async (context) => {
	const env = getSiteEnv();
	const denied = requireReleaseOperator(context, env);
	if (denied) return denied;
	if (!env.SUPERBOARD_RELEASE_PRIVATE_JWK) {
		return jsonResponse({ error: { code: "RELEASE_SIGNING_KEY_UNAVAILABLE" } }, 503);
	}

	let failedCompilation:
		| { compilation_id: string; draft_snapshot_id: string; candidate_id: string | null }
		| undefined;
	try {
		const requestBody: unknown = await context.request.json();
		if (
			requestBody === null ||
			typeof requestBody !== "object" ||
			!("draft_snapshot_id" in requestBody) ||
			typeof requestBody.draft_snapshot_id !== "string"
		) {
			return jsonResponse({ error: { code: "DRAFT_SNAPSHOT_REQUIRED" } }, 422);
		}
		const snapshot = await loadDraftSnapshot(env.DB, requestBody.draft_snapshot_id);
		if (!snapshot || snapshot.instance_id !== env.SUPERBOARD_INSTANCE_ID) {
			return jsonResponse({ error: { code: "DRAFT_SNAPSHOT_NOT_FOUND" } }, 404);
		}
		const input: unknown = snapshot.input;
		if (isRecord(input) && typeof input.compilation_id === "string") {
			failedCompilation = {
				compilation_id: input.compilation_id,
				draft_snapshot_id: snapshot.draft_snapshot_id,
				candidate_id: typeof input.candidate_id === "string" ? input.candidate_id : null,
			};
		}
		assertFrontReleaseInput(input);
		if (
			input.front_draft_id !== snapshot.front_draft_id ||
			input.draft_snapshot_id !== snapshot.draft_snapshot_id
		) {
			if (failedCompilation) {
				await recordCompilation(env.DB, {
					...failedCompilation,
					status: "rejected",
					error_code: "SNAPSHOT_IDENTITY_MISMATCH",
					created_at: new Date().toISOString(),
				});
				failedCompilation = undefined;
			}
			return jsonResponse({ error: { code: "SNAPSHOT_IDENTITY_MISMATCH" } }, 409);
		}
		if (input.instance_id !== env.SUPERBOARD_INSTANCE_ID) {
			return jsonResponse({ error: { code: "INSTANCE_MISMATCH" } }, 409);
		}
		const privateJwk = parsePrivateReleaseJwk(env.SUPERBOARD_RELEASE_PRIVATE_JWK);
		const privateKey = await crypto.subtle.importKey(
			"jwk",
			privateJwk,
			{ name: "ECDSA", namedCurve: "P-256" },
			true,
			["sign"],
		);
		const release = await compileFrontRelease(input, {
			kid: privateJwk.kid,
			private_key: privateKey,
		});
		await stageCompiledFrontRelease(env.DB, release, publicJwk(privateJwk), new Date().toISOString());
		await recordCompilation(env.DB, {
			compilation_id: input.compilation_id,
			draft_snapshot_id: snapshot.draft_snapshot_id,
			candidate_id: release.payload.candidate_id,
			status: "compiled",
			error_code: null,
			created_at: new Date().toISOString(),
		});
		return jsonResponse(
			{
				candidate_id: release.payload.candidate_id,
				release_id: release.payload.release_id,
				content_checksum: release.content_checksum,
				validation_set_checksum: release.validation_set_checksum,
				signature: release.signature,
				validation_receipts: release.validation_receipts,
				status: "validated",
			},
			201,
		);
	} catch (error) {
		if (failedCompilation) {
			await recordCompilation(env.DB, {
				...failedCompilation,
				status: "failed",
				error_code: "FRONT_RELEASE_COMPILATION_FAILED",
				created_at: new Date().toISOString(),
			});
		}
		return jsonResponse(
			{
				error: {
					code: "FRONT_RELEASE_COMPILATION_FAILED",
					message: error instanceof Error ? error.message : "Invalid compilation input",
				},
			},
			422,
		);
	}
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePrivateReleaseJwk(value: string): ReleasePrivateJwk {
	const jwk: unknown = JSON.parse(value);
	if (
		jwk === null ||
		typeof jwk !== "object" ||
		!("kty" in jwk) ||
		jwk.kty !== "EC" ||
		!("crv" in jwk) ||
		jwk.crv !== "P-256" ||
		!("x" in jwk) ||
		typeof jwk.x !== "string" ||
		!("y" in jwk) ||
		typeof jwk.y !== "string" ||
		!("d" in jwk) ||
		typeof jwk.d !== "string" ||
		!("kid" in jwk) ||
		typeof jwk.kid !== "string" ||
		!("alg" in jwk) ||
		jwk.alg !== "ES256"
	) {
		throw new TypeError("Release signing JWK must be an ES256 P-256 private key with kid");
	}
	return {
		kty: "EC",
		crv: "P-256",
		x: jwk.x,
		y: jwk.y,
		d: jwk.d,
		kid: jwk.kid,
		alg: "ES256",
		key_ops: ["sign"],
		ext: true,
	};
}

function publicJwk(privateJwk: ReleasePrivateJwk): ReleasePublicJwk {
	return {
		kty: "EC",
		crv: "P-256",
		x: privateJwk.x,
		y: privateJwk.y,
		kid: privateJwk.kid,
		alg: "ES256",
		use: "sig",
		key_ops: ["verify"],
		ext: true,
	};
}
