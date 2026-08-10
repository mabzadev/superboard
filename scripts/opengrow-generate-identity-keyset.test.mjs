import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { generateIdentityKeyset, assertSafeOutputPath } from "./opengrow-generate-identity-keyset.mjs";
import { root } from "./cloudflare-target.mjs";

test("identity key generation creates one active private ES256 key", async () => {
  const keyset = await generateIdentityKeyset();
  assert.match(keyset.active_kid, /^identity-\d{4}-\d{2}-\d{2}-[a-f0-9]{12}$/);
  assert.equal(keyset.keys.length, 1);
  assert.deepEqual(
    {
      kid: keyset.keys[0].kid,
      kty: keyset.keys[0].kty,
      crv: keyset.keys[0].crv,
      alg: keyset.keys[0].alg,
      use: keyset.keys[0].use,
    },
    {
      kid: keyset.active_kid,
      kty: "EC",
      crv: "P-256",
      alg: "ES256",
      use: "sig",
    },
  );
  assert.equal(typeof keyset.keys[0].d, "string");
  assert.equal(typeof keyset.keys[0].x, "string");
  assert.equal(typeof keyset.keys[0].y, "string");
});

test("identity keys cannot be written into the repository", () => {
  assert.throws(
    () => assertSafeOutputPath(resolve(root, "private-key.json")),
    /inside the Git repository/,
  );
  assert.throws(() => assertSafeOutputPath("relative-key.json"), /absolute path/);
  assert.equal(assertSafeOutputPath("/tmp/opengrow-identity-keyset.json"), "/tmp/opengrow-identity-keyset.json");
});
