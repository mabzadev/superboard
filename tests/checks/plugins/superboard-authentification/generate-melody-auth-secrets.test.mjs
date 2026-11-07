import assert from "node:assert/strict";
import test from "node:test";

import {
	generateMelodyAuthSecrets,
	serializeMelodyAuthSecrets,
} from "../../../../packages/plugins/superboard-authentification/scripts/generate-melody-auth-secrets.mjs";

test("generates RS256 JWT material and a session secret", async () => {
	const secrets = await generateMelodyAuthSecrets();
	assert.match(secrets.jwtPrivateKeyPem, /BEGIN PRIVATE KEY/u);
	assert.match(secrets.jwtPublicKeyPem, /BEGIN PUBLIC KEY/u);
	assert.ok(secrets.sessionSecret.length >= 64);
	const serialized = serializeMelodyAuthSecrets(secrets);
	assert.ok(Buffer.byteLength(serialized) <= 5 * 1024);
	assert.deepEqual(Object.keys(JSON.parse(serialized)).sort(), ["jp", "ju", "ss", "v"]);
});
