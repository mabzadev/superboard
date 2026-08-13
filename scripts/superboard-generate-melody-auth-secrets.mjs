#!/usr/bin/env node
import { randomBytes, webcrypto } from "node:crypto";
import { open } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as x509 from "@peculiar/x509";
import { assertSafeOutputPath } from "./superboard-generate-identity-keyset.mjs";
import { parseArgs } from "./cloudflare-target.mjs";

const RSA_ALGORITHM = Object.freeze({
  name: "RSASSA-PKCS1-v1_5",
  hash: "SHA-256",
  publicExponent: new Uint8Array([1, 0, 1]),
  modulusLength: 2048,
});
const CLOUDFLARE_SECRET_MAX_BYTES = 5 * 1024;

export async function generateMelodyAuthSecrets(now = new Date()) {
  x509.cryptoProvider.set(webcrypto);
  const jwtKeys = await webcrypto.subtle.generateKey(
    RSA_ALGORITHM,
    true,
    ["sign", "verify"],
  );
  const samlKeys = await webcrypto.subtle.generateKey(
    RSA_ALGORITHM,
    true,
    ["sign", "verify"],
  );
  const notBefore = new Date(now.getTime() - 5 * 60 * 1_000);
  const notAfter = new Date(now);
  notAfter.setUTCFullYear(notAfter.getUTCFullYear() + 10);
  const certificate = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: randomBytes(16).toString("hex"),
    name: "CN=SuperBoard Identity SAML SP,O=SuperBoard",
    notBefore,
    notAfter,
    signingAlgorithm: RSA_ALGORITHM,
    keys: samlKeys,
    extensions: [
      new x509.BasicConstraintsExtension(false, undefined, true),
      new x509.KeyUsagesExtension(
        x509.KeyUsageFlags.digitalSignature |
          x509.KeyUsageFlags.keyEncipherment,
        true,
      ),
      await x509.SubjectKeyIdentifierExtension.create(samlKeys.publicKey),
    ],
  });

  return {
    jwtPrivateKeyPem: pem(
      "PRIVATE KEY",
      await webcrypto.subtle.exportKey("pkcs8", jwtKeys.privateKey),
    ),
    jwtPublicKeyPem: pem(
      "PUBLIC KEY",
      await webcrypto.subtle.exportKey("spki", jwtKeys.publicKey),
    ),
    sessionSecret: randomBytes(48).toString("base64url"),
    samlPrivateKeyPem: pem(
      "PRIVATE KEY",
      await webcrypto.subtle.exportKey("pkcs8", samlKeys.privateKey),
    ),
    samlCertificatePem: certificate.toString("pem"),
  };
}

function pem(label, bytes) {
  const base64 = Buffer.from(bytes).toString("base64");
  const lines = base64.match(/.{1,64}/gu) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----`;
}

export function serializeMelodyAuthSecrets(secrets) {
  const value = JSON.stringify({
    v: 1,
    jp: pemBody(secrets.jwtPrivateKeyPem, "PRIVATE KEY"),
    ju: pemBody(secrets.jwtPublicKeyPem, "PUBLIC KEY"),
    ss: secrets.sessionSecret,
    sp: pemBody(secrets.samlPrivateKeyPem, "PRIVATE KEY"),
    sc: pemBody(secrets.samlCertificatePem, "CERTIFICATE"),
  });
  if (Buffer.byteLength(value) > CLOUDFLARE_SECRET_MAX_BYTES) {
    throw new Error("Compact Melody Auth material exceeds the Cloudflare secret limit");
  }
  return value;
}

function pemBody(value, label) {
  const prefix = `-----BEGIN ${label}-----`;
  const suffix = `-----END ${label}-----`;
  if (
    typeof value !== "string" ||
    !value.includes(prefix) ||
    !value.includes(suffix)
  ) {
    throw new Error(`Invalid ${label} material`);
  }
  return value.replace(prefix, "").replace(suffix, "").replace(/\s/gu, "");
}

export async function writeMelodyAuthSecrets(output) {
  const destination = assertSafeOutputPath(output);
  const secrets = await generateMelodyAuthSecrets();
  const file = await open(destination, "wx", 0o600);
  try {
    await file.writeFile(`${serializeMelodyAuthSecrets(secrets)}\n`, {
      encoding: "utf8",
    });
  } finally {
    await file.close();
  }
  return destination;
}

async function main() {
  const args = parseArgs();
  const destination = await writeMelodyAuthSecrets(args.output);
  process.stdout.write(
    `Melody Auth signing secrets created at ${destination} with mode 0600. Upload the JSON as MELODY_AUTH_SECRETS, then move it to the approved secret manager or securely remove it.\n`,
  );
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  await main();
}
