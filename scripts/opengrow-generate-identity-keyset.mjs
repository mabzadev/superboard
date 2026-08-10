import { randomBytes, webcrypto } from "node:crypto";
import { open } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs, root } from "./cloudflare-target.mjs";

export async function generateIdentityKeyset() {
  const pair = await webcrypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const privateKey = await webcrypto.subtle.exportKey("jwk", pair.privateKey);
  const kid = `identity-${new Date().toISOString().slice(0, 10)}-${randomBytes(6).toString("hex")}`;
  return {
    active_kid: kid,
    keys: [{ ...privateKey, kid, alg: "ES256", use: "sig" }],
  };
}

export function assertSafeOutputPath(output) {
  if (typeof output !== "string" || output.trim() === "") {
    throw new Error("--output must name a new secret file outside the Git repository");
  }
  if (!isAbsolute(output)) throw new Error("--output must be an absolute path");
  const destination = resolve(output);
  const repositoryRelative = relative(root, destination);
  if (repositoryRelative === "" || (!repositoryRelative.startsWith("..") && !isAbsolute(repositoryRelative))) {
    throw new Error("Refusing to write private signing material inside the Git repository");
  }
  return destination;
}

export async function writeIdentityKeyset(output) {
  const destination = assertSafeOutputPath(output);
  const keyset = await generateIdentityKeyset();
  const file = await open(destination, "wx", 0o600);
  try {
    await file.writeFile(`${JSON.stringify(keyset)}\n`, { encoding: "utf8" });
  } finally {
    await file.close();
  }
  return destination;
}

async function main() {
  const args = parseArgs();
  const destination = await writeIdentityKeyset(args.output);
  process.stdout.write(
    `Identity keyset created at ${destination} with mode 0600. Upload it through stdin, then move it to the approved secret manager or securely remove it.\n`,
  );
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
