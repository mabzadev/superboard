import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { Miniflare } from "miniflare";

test("the Worker verifies runner signatures without following a redirected key endpoint", async () => {
	const pair = await crypto.subtle.generateKey(
		{
			name: "RSASSA-PKCS1-v1_5",
			modulusLength: 2048,
			publicExponent: new Uint8Array([1, 0, 1]),
			hash: "SHA-256",
		},
		true,
		["sign", "verify"],
	);
	const jwk = {
		...(await crypto.subtle.exportKey("jwk", pair.publicKey)),
		kid: "runtime-fixture",
		use: "sig",
	};
	const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
	const claims = {
		iss: "https://token.actions.githubusercontent.com",
		aud: "superboard-installer",
		repository: "mabzadev/superboard",
		repository_id: "1307937671",
		repository_owner_id: "95926658",
		ref: "refs/heads/main",
		workflow_ref:
			"mabzadev/superboard/.github/workflows/cloudflare-installations.yml@refs/heads/main",
		sub: "repo:mabzadev@95926658/superboard@1307937671:ref:refs/heads/main",
		runner_environment: "github-hosted",
		event_name: "push",
		exp: Date.now() / 1000 + 600,
		iat: Date.now() / 1000,
		run_id: "123",
		sha: "1".repeat(40),
	};
	const unsigned = `${encode({ alg: "RS256", kid: jwk.kid })}.${encode(claims)}`;
	const signature = await crypto.subtle.sign(
		"RSASSA-PKCS1-v1_5",
		pair.privateKey,
		new TextEncoder().encode(unsigned),
	);
	const headers = {
		Authorization: `Bearer ${unsigned}.${Buffer.from(signature).toString("base64url")}`,
	};
	let redirect = false;
	const requests = [];
	const source = await readFile(
		new URL("../../../infra/cloudflare-installer/runner-identity.mjs", import.meta.url),
		"utf8",
	);
	const worker = new Miniflare({
		modules: true,
		compatibilityDate: "2026-08-01",
		script: `${source}\nexport default { async fetch(request) { try { return Response.json(await runnerIdentity(request)); } catch(error) { return Response.json({ error: error.message }, { status: 401 }); } } };`,
		outboundService(request) {
			requests.push(request.url);
			return redirect
				? new Response(null, { status: 302, headers: { Location: "https://foreign.example/keys" } })
				: Response.json({ keys: [jwk] });
		},
	});
	try {
		const accepted = await worker.dispatchFetch("https://installer.example/runner/jobs", {
			headers,
		});
		assert.equal(accepted.status, 200, await accepted.clone().text());
		assert.equal((await accepted.json()).runId, "123");
		redirect = true;
		const rejected = await worker.dispatchFetch("https://installer.example/runner/jobs", {
			headers,
		});
		assert.equal(rejected.status, 401);
		assert.equal((await rejected.json()).error, "INSTALLATION_RUNNER_KEYS_UNAVAILABLE");
		assert.deepEqual(
			requests,
			Array(2).fill("https://token.actions.githubusercontent.com/.well-known/jwks"),
		);
	} finally {
		await worker.dispose();
	}
});
