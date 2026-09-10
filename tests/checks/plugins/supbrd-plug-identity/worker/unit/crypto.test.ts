import { exportJWK, generateKeyPair } from "jose";
import { beforeAll, describe, expect, it } from "vitest";

import {
	issueAccessToken,
	issueSuperBoardToken,
	publicJwks,
	verifyApplicationToken,
} from "../../../../../../packages/plugins/supbrd-plug-identity/worker/src/crypto";
import type { IdentityEnv } from "../../../../../../packages/plugins/supbrd-plug-identity/worker/src/types";

let env: IdentityEnv;

beforeAll(async () => {
	const pair = await generateKeyPair("ES256", { extractable: true });
	const privateKey = await exportJWK(pair.privateKey);
	privateKey.kid = "identity-test-key";
	env = {
		IDENTITY_KEYSET: JSON.stringify({
			active_kid: "identity-test-key",
			keys: [privateKey],
		}),
		SUPERBOARD_IDENTITY_ISSUER: "https://api.example.test",
		SUPERBOARD_IDENTITY_AUDIENCE: "superboard",
		SUPERBOARD_IDENTITY_TOKEN_TTL: "300",
		APPLICATION_AUDIENCE: "example.application",
		ACCESS_TOKEN_TTL: "900",
	} as IdentityEnv;
});

describe("application identity keys", () => {
	it("never exposes private key material through JWKS", () => {
		expect(publicJwks(env).keys[0]).toMatchObject({
			kid: "identity-test-key",
			alg: "ES256",
			use: "sig",
		});
		expect(publicJwks(env).keys[0]).not.toHaveProperty("d");
	});

	it("issues an application token only for the application audience", async () => {
		const token = await issueAccessToken(env, 42, "user-1", "session-1");
		await expect(verifyApplicationToken(env, token)).resolves.toMatchObject({
			sub: "user-1",
			sid: "session-1",
			pid: 42,
			aud: "example.application",
			type: "application_access",
		});
	});

	it("issues short-lived SuperBoard exchange tokens with a distinct audience", async () => {
		const result = await issueSuperBoardToken(env, 42, "user-1");
		expect(result.expires_in).toBe(300);
		await expect(verifyApplicationToken(env, result.access_token)).rejects.toThrow();
	});
});
