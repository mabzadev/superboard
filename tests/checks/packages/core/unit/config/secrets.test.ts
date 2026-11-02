import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import type { Kysely } from "kysely";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
	EmDashSecretsError,
	IP_SALT_OPTION_KEY,
	PREVIEW_SECRET_OPTION_KEY,
	_clearSecretsCacheForTesting,
	fingerprintKey,
	generateEncryptionKey,
	parseEncryptionKeys,
	resolveSecrets,
	resolveSecretsCached,
	validateEncryptionKeyAtStartup,
} from "../../../../../../packages/core/src/config/secrets.js";
import { OptionsRepository } from "../../../../../../packages/core/src/database/repositories/options.js";
import type { Database } from "../../../../../../packages/core/src/database/types.js";
import { setupTestDatabase, teardownTestDatabase } from "../../utils/test-db.js";

describe("config/secrets", () => {
	let db: Kysely<Database>;

	beforeEach(async () => {
		db = await setupTestDatabase();
		_clearSecretsCacheForTesting();
	});

	afterEach(async () => {
		_clearSecretsCacheForTesting();
		await teardownTestDatabase(db);
	});

	describe("generateEncryptionKey", () => {
		it("emits the v1 prefix and a base64url body", () => {
			const key = generateEncryptionKey();
			expect(key.startsWith("emdash_enc_v1_")).toBe(true);
			const body = key.slice("emdash_enc_v1_".length);
			expect(body).toHaveLength(43);
			expect(body).toMatch(/^[A-Za-z0-9_-]+$/);
		});

		it("produces unique values across calls", () => {
			const a = generateEncryptionKey();
			const b = generateEncryptionKey();
			expect(a).not.toBe(b);
		});
	});

	describe("parseEncryptionKeys", () => {
		it("returns null for unset / empty input", async () => {
			expect(await parseEncryptionKeys(undefined)).toBeNull();
			expect(await parseEncryptionKeys("")).toBeNull();
			expect(await parseEncryptionKeys(",,,")).toBeNull();
			expect(await parseEncryptionKeys("   ")).toBeNull();
		});

		it("parses a single valid key into a {kid, key, raw} entry", async () => {
			const raw = generateEncryptionKey();
			const parsed = await parseEncryptionKeys(raw);
			expect(parsed).toHaveLength(1);
			expect(parsed?.[0]?.raw).toBe(raw);
			expect(parsed?.[0]?.key).toBeInstanceOf(Uint8Array);
			expect(parsed?.[0]?.key.byteLength).toBe(32);
			expect(parsed?.[0]?.kid).toMatch(/^[0-9a-f]{8}$/);
		});

		it("kid is stable across repeated calls and matches fingerprintKey()", async () => {
			const raw = generateEncryptionKey();
			const a = await parseEncryptionKeys(raw);
			const b = await parseEncryptionKeys(raw);
			expect(a?.[0]?.kid).toBe(b?.[0]?.kid);
			expect(await fingerprintKey(raw)).toBe(a?.[0]?.kid);
		});

		it("parses comma-separated multi-key with whitespace tolerance", async () => {
			const a = generateEncryptionKey();
			const b = generateEncryptionKey();
			const parsed = await parseEncryptionKeys(` ${a} ,  ${b}  ,`);
			expect(parsed).toHaveLength(2);
			expect(parsed?.[0]?.raw).toBe(a);
			expect(parsed?.[1]?.raw).toBe(b);
		});

		it("dedupes keys with the same kid (paste mistakes)", async () => {
			const raw = generateEncryptionKey();
			const parsed = await parseEncryptionKeys(`${raw},${raw}`);
			expect(parsed).toHaveLength(1);
		});

		it("throws on a malformed prefix", async () => {
			await expect(parseEncryptionKeys("not_a_key")).rejects.toBeInstanceOf(EmDashSecretsError);
		});

		it("throws on a malformed body (too short)", async () => {
			await expect(parseEncryptionKeys("emdash_enc_v1_tooShort")).rejects.toBeInstanceOf(
				EmDashSecretsError,
			);
		});

		it("throws on a malformed body (non base64url chars)", async () => {
			const bad = "emdash_enc_v1_" + "!".repeat(43);
			await expect(parseEncryptionKeys(bad)).rejects.toBeInstanceOf(EmDashSecretsError);
		});

		it("throws if any entry in a multi-key list is malformed", async () => {
			const good = generateEncryptionKey();
			await expect(parseEncryptionKeys(`${good},not_a_key`)).rejects.toBeInstanceOf(
				EmDashSecretsError,
			);
		});

		it("rejects non-canonical base64url so kid stays stable per key material", async () => {
			const canonical = `emdash_enc_v1_${"A".repeat(43)}`;
			const nonCanonical = `emdash_enc_v1_${"A".repeat(42)}B`;

			expect(canonical).toMatch(/^emdash_enc_v1_[A-Za-z0-9_-]{43}$/);
			expect(nonCanonical).toMatch(/^emdash_enc_v1_[A-Za-z0-9_-]{43}$/);

			await expect(parseEncryptionKeys(canonical)).resolves.toBeTruthy();

			await expect(parseEncryptionKeys(nonCanonical)).rejects.toThrow(EmDashSecretsError);
		});
	});

	describe("resolveSecrets", () => {
		it("default path generates and persists IP salt + preview secret", async () => {
			const result = await resolveSecrets({ db, env: {} });

			expect(result.ipSaltSource).toBe("db");
			expect(result.previewSecretSource).toBe("db");
			expect(result.ipSalt.length).toBeGreaterThan(0);
			expect(result.previewSecret.length).toBeGreaterThan(0);

			const repo = new OptionsRepository(db);
			expect(await repo.get<string>(IP_SALT_OPTION_KEY)).toBe(result.ipSalt);
			expect(await repo.get<string>(PREVIEW_SECRET_OPTION_KEY)).toBe(result.previewSecret);
		});

		it("does not consult EMDASH_ENCRYPTION_KEY (a malformed key cannot break preview/comments)", async () => {
			const result = await resolveSecrets({
				db,
				env: { EMDASH_ENCRYPTION_KEY: "not_a_valid_key" },
			});
			expect(result.previewSecret.length).toBeGreaterThan(0);
			expect(result.ipSalt.length).toBeGreaterThan(0);
		});

		it("env override wins for preview secret and ip salt", async () => {
			const result = await resolveSecrets({
				db,
				env: {
					EMDASH_PREVIEW_SECRET: "env-preview",
					EMDASH_IP_SALT: "env-ip-salt",
				},
			});
			expect(result.previewSecret).toBe("env-preview");
			expect(result.previewSecretSource).toBe("env");
			expect(result.ipSalt).toBe("env-ip-salt");
			expect(result.ipSaltSource).toBe("env");

			const repo = new OptionsRepository(db);
			expect(await repo.get<string>(IP_SALT_OPTION_KEY)).toBeNull();
			expect(await repo.get<string>(PREVIEW_SECRET_OPTION_KEY)).toBeNull();
		});

		it("legacy PREVIEW_SECRET fallback works (unprefixed name)", async () => {
			const result = await resolveSecrets({
				db,
				env: { PREVIEW_SECRET: "legacy-preview" },
			});
			expect(result.previewSecret).toBe("legacy-preview");
			expect(result.previewSecretSource).toBe("env");
		});

		it("legacy EMDASH_AUTH_SECRET fallback for IP salt is honored", async () => {
			const result = await resolveSecrets({
				db,
				env: { EMDASH_AUTH_SECRET: "legacy-auth" },
			});
			expect(result.ipSalt).toBe("legacy-auth");
			expect(result.ipSaltSource).toBe("env");
		});

		it("EMDASH_IP_SALT wins over EMDASH_AUTH_SECRET fallback", async () => {
			const result = await resolveSecrets({
				db,
				env: {
					EMDASH_IP_SALT: "explicit-salt",
					EMDASH_AUTH_SECRET: "legacy-auth",
				},
			});
			expect(result.ipSalt).toBe("explicit-salt");
		});

		it("idempotent: repeated calls return the same DB-stored values", async () => {
			const a = await resolveSecrets({ db, env: {} });
			const b = await resolveSecrets({ db, env: {} });
			expect(a.ipSalt).toBe(b.ipSalt);
			expect(a.previewSecret).toBe(b.previewSecret);
		});

		it("repeated first-resolves are idempotent (sequential test of convergence)", async () => {
			const promises: Promise<Awaited<ReturnType<typeof resolveSecrets>>>[] = [];
			for (let i = 0; i < 5; i++) {
				promises.push(resolveSecrets({ db, env: {} }));
			}
			const results = await Promise.all(promises);
			const ipSalts = new Set(results.map((r) => r.ipSalt));
			const previews = new Set(results.map((r) => r.previewSecret));
			expect(ipSalts.size).toBe(1);
			expect(previews.size).toBe(1);
		});

		it("returns the existing row when first-read finds one already populated", async () => {
			const winnerSalt = "row-already-populated";
			const repo = new OptionsRepository(db);
			await repo.set(IP_SALT_OPTION_KEY, winnerSalt);

			const result = await resolveSecrets({ db, env: {} });
			expect(result.ipSalt).toBe(winnerSalt);
			expect(result.ipSaltSource).toBe("db");
		});

		it("converges via lost-race re-read when setIfAbsent reports no insert", async () => {
			const winnerSalt = "concurrent-process-won";
			const realRepo = new OptionsRepository(db);
			const stubRepo = Object.create(realRepo) as OptionsRepository;
			stubRepo.setIfAbsent = async <T>(name: string, value: T) => {
				if (name === IP_SALT_OPTION_KEY) {
					await realRepo.set(name, winnerSalt);
					return false;
				}
				return realRepo.setIfAbsent(name, value);
			};

			const result = await resolveSecrets({ db, env: {}, _repo: stubRepo });
			expect(result.ipSalt).toBe(winnerSalt);
			expect(result.ipSaltSource).toBe("db");
		});

		it("throws SECRET_PERSIST_FAILED when setIfAbsent loses but the row is empty after re-read", async () => {
			const realRepo = new OptionsRepository(db);
			const stubRepo = Object.create(realRepo) as OptionsRepository;
			stubRepo.setIfAbsent = async () => false;

			await expect(resolveSecrets({ db, env: {}, _repo: stubRepo })).rejects.toThrow(
				/SECRET_PERSIST_FAILED|Failed to persist/,
			);
		});

		it("reads the default env from process.env when no env map is passed", async () => {
			const previous = process.env.EMDASH_PREVIEW_SECRET;
			process.env.EMDASH_PREVIEW_SECRET = "proc-preview-secret";
			try {
				const result = await resolveSecrets({ db });
				expect(result.previewSecret).toBe("proc-preview-secret");
				expect(result.previewSecretSource).toBe("env");
			} finally {
				if (previous === undefined) {
					delete process.env.EMDASH_PREVIEW_SECRET;
				} else {
					process.env.EMDASH_PREVIEW_SECRET = previous;
				}
			}
		});
	});

	describe("validateEncryptionKeyAtStartup", () => {
		it("returns true for an unset key", async () => {
			expect(await validateEncryptionKeyAtStartup({})).toBe(true);
		});

		it("returns true for a valid key", async () => {
			const key = generateEncryptionKey();
			expect(await validateEncryptionKeyAtStartup({ EMDASH_ENCRYPTION_KEY: key })).toBe(true);
		});

		it("returns false (and does not throw) for a malformed key, logging an operator-facing message", async () => {
			const errors: unknown[][] = [];
			const original = console.error;
			console.error = (...args: unknown[]) => {
				errors.push(args);
			};
			try {
				const result = await validateEncryptionKeyAtStartup({
					EMDASH_ENCRYPTION_KEY: "not_a_valid_key",
				});
				expect(result).toBe(false);
				expect(errors).toHaveLength(1);
				expect(String(errors[0]?.[0])).toMatch(/EMDASH_ENCRYPTION_KEY is invalid/);
			} finally {
				console.error = original;
			}
		});
	});

	describe("fingerprintKey", () => {
		it("agrees with parseEncryptionKeys on canonical input", async () => {
			const raw = generateEncryptionKey();
			const parsed = await parseEncryptionKeys(raw);
			expect(await fingerprintKey(raw)).toBe(parsed?.[0]?.kid);
		});

		it("rejects non-canonical base64url (so the CLI can't print kids the runtime would refuse)", async () => {
			const nonCanonical = `emdash_enc_v1_${"A".repeat(42)}B`;
			await expect(fingerprintKey(nonCanonical)).rejects.toBeInstanceOf(EmDashSecretsError);
		});

		it("rejects a malformed prefix", async () => {
			await expect(fingerprintKey("not_a_key")).rejects.toBeInstanceOf(EmDashSecretsError);
		});

		it("rejects bodies of the wrong length", async () => {
			await expect(fingerprintKey("emdash_enc_v1_tooShort")).rejects.toBeInstanceOf(
				EmDashSecretsError,
			);
		});
	});

	describe("resolveSecretsCached", () => {
		it("memoizes per-db so multiple callers share one resolved value", async () => {
			const a = await resolveSecretsCached(db);
			const b = await resolveSecretsCached(db);
			expect(a).toBe(b);

			_clearSecretsCacheForTesting();
			const c = await resolveSecretsCached(db);
			expect(c).not.toBe(a);
			expect(c.ipSalt).toBe(a.ipSalt);
			expect(c.previewSecret).toBe(a.previewSecret);
		});
	});

	describe("source hygiene", () => {
		it("never references import.meta.env in code (would be inlined into the server bundle at build time)", async () => {
			const source = await readFile(
				fileURLToPath(
					new URL("../../../../../../packages/core/src/config/secrets.ts", import.meta.url),
				),
				"utf8",
			);
			const withoutComments = source
				.replace(/\/\*[\s\S]*?\*\//g, "")
				.replace(/^[ \t]*\/\/.*$/gm, "");
			expect(withoutComments).not.toContain("import.meta.env");
		});
	});
});
