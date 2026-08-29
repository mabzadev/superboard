import { assertFrontReleaseInput, compileFrontRelease } from "@superboard/supbrd-core";
import type { APIRoute } from "astro";

import { jsonResponse, requireReleaseOperator } from "../../../../lib/operator-guard.js";
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

	try {
		const input: unknown = await context.request.json();
		assertFrontReleaseInput(input);
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
