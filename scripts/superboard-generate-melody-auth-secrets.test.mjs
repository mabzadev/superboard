import assert from "node:assert/strict";
import test from "node:test";
import { X509Certificate } from "node:crypto";
import {
  generateMelodyAuthSecrets,
  serializeMelodyAuthSecrets,
} from "./superboard-generate-melody-auth-secrets.mjs";

test("generates independent RS256 JWT and SAML material", async () => {
  const secrets = await generateMelodyAuthSecrets(
    new Date("2026-08-13T00:00:00.000Z"),
  );
  assert.match(secrets.jwtPrivateKeyPem, /BEGIN PRIVATE KEY/u);
  assert.match(secrets.jwtPublicKeyPem, /BEGIN PUBLIC KEY/u);
  assert.match(secrets.samlPrivateKeyPem, /BEGIN PRIVATE KEY/u);
  assert.notEqual(secrets.jwtPrivateKeyPem, secrets.samlPrivateKeyPem);
  assert.ok(secrets.sessionSecret.length >= 64);
  const certificate = new X509Certificate(secrets.samlCertificatePem);
  assert.match(certificate.subject, /CN=SuperBoard Identity SAML SP/u);
  assert.ok(certificate.validTo);
  const serialized = serializeMelodyAuthSecrets(secrets);
  assert.ok(Buffer.byteLength(serialized) <= 5 * 1024);
  assert.deepEqual(Object.keys(JSON.parse(serialized)).sort(), [
    "jp",
    "ju",
    "sc",
    "sp",
    "ss",
    "v",
  ]);
});
