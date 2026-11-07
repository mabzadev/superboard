import { exportPKCS8, exportSPKI, generateKeyPair } from "jose";
import { beforeAll, describe, expect, it } from "vitest";

import { melodyBindings } from "../../../../../../packages/plugins/superboard-authentification/worker/src/melody-runtime";
import type { IdentityEnv } from "../../../../../../packages/plugins/superboard-authentification/worker/src/types";

const sessionSecret = "s".repeat(48);
let privateKeyPem: string;
let publicKeyPem: string;

beforeAll(async () => {
	const pair = await generateKeyPair("RS256", { extractable: true });
	privateKeyPem = await exportPKCS8(pair.privateKey);
	publicKeyPem = await exportSPKI(pair.publicKey);
});

const pemBody = (pem: string) => pem.replace(/-----[A-Z ]+-----/gu, "").replace(/\s/gu, "");

const emptyDatabase = {
	prepare: () => ({ bind: () => ({ first: () => Promise.resolve(null) }) }),
};

function bindingsFor(secrets: Record<string, unknown>) {
	return melodyBindings({
		DB: emptyDatabase,
		MELODY_AUTH_SECRETS: JSON.stringify(secrets),
		MELODY_ENVIRONMENT: "prod",
	} as unknown as IdentityEnv & {
		ASSETS: Fetcher;
		MELODY_AUTH_SECRETS: string;
		MELODY_ENVIRONMENT: string;
	});
}

describe("Melody Auth secrets", () => {
	it("accepts a compact secret that still carries the retired SAML material", async () => {
		const bindings = bindingsFor({
			v: 1,
			jp: pemBody(privateKeyPem),
			ju: pemBody(publicKeyPem),
			ss: sessionSecret,
			sp: "retired",
			sc: "retired",
		});
		expect(await bindings.KV.get("jwtPrivateSecret")).toContain("BEGIN PRIVATE KEY");
		expect(await bindings.KV.get("samlSpKey")).toBeNull();
		expect(await bindings.KV.get("samlSpCrt")).toBeNull();
	});

	it("accepts a compact secret without SAML material", async () => {
		const bindings = bindingsFor({
			v: 1,
			jp: pemBody(privateKeyPem),
			ju: pemBody(publicKeyPem),
			ss: sessionSecret,
		});
		expect(await bindings.KV.get("sessionSecret")).toBe(sessionSecret);
	});

	it("accepts a legacy secret that still carries the retired SAML material", async () => {
		const bindings = bindingsFor({
			jwtPrivateKeyPem: privateKeyPem,
			jwtPublicKeyPem: publicKeyPem,
			sessionSecret,
			samlPrivateKeyPem: "retired",
			samlCertificatePem: "retired",
		});
		expect(await bindings.KV.get("jwtPublicSecret")).toContain("BEGIN PUBLIC KEY");
		expect(await bindings.KV.get("samlSpKey")).toBeNull();
	});
});
