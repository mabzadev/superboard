import { sha256 } from "@oslojs/crypto/sha2";
import { encodeHexLowerCase } from "@oslojs/encoding";
import type { Kysely } from "kysely";

import { after } from "../after.js";
import { OptionsRepository } from "../database/repositories/options.js";
import type { Database } from "../database/types.js";
import { decodeBase64url, encodeBase64url } from "../utils/base64.js";
import {
	createSingleFlightCache,
	type SingleFlightCache,
	singleFlightCached,
} from "../utils/single-flight-cache.js";

export const ENCRYPTION_KEY_PREFIX = "emdash_enc_v1_";

const ENCRYPTION_KEY_BODY_LENGTH = 43;

const REGEX_META_PATTERN = /[.*+?^${}()|[\]\\]/g;

const ENCRYPTION_KEY_PATTERN = new RegExp(
	`^${ENCRYPTION_KEY_PREFIX.replace(REGEX_META_PATTERN, "\\$&")}[A-Za-z0-9_-]{${ENCRYPTION_KEY_BODY_LENGTH}}$`,
);

export const IP_SALT_OPTION_KEY = "emdash:ip_salt";

export const PREVIEW_SECRET_OPTION_KEY = "emdash:preview_secret";

const GENERATED_SECRET_BYTES = 32;

export interface ParsedEncryptionKey {
	kid: string;
	key: Uint8Array;
	raw: string;
}

export interface ResolvedSecrets {
	previewSecret: string;
	previewSecretSource: "env" | "db";
	ipSalt: string;
	ipSaltSource: "env" | "db";
}

export interface ResolveSecretsOptions {
	db: Kysely<Database>;
	env?: SecretsEnv;
	_repo?: OptionsRepository;
}

export interface SecretsEnv {
	EMDASH_ENCRYPTION_KEY?: string;
	EMDASH_PREVIEW_SECRET?: string;
	PREVIEW_SECRET?: string;
	EMDASH_IP_SALT?: string;
	EMDASH_AUTH_SECRET?: string;
	AUTH_SECRET?: string;
}

export class EmDashSecretsError extends Error {
	override readonly name = "EmDashSecretsError";
	readonly code: string;

	constructor(message: string, code: string) {
		super(message);
		this.code = code;
	}
}

export async function parseEncryptionKeys(
	raw: string | undefined,
): Promise<ParsedEncryptionKey[] | null> {
	if (!raw) return null;

	const entries = raw
		.split(",")
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);

	if (entries.length === 0) return null;

	const parsed: ParsedEncryptionKey[] = [];
	const seenKids = new Set<string>();

	for (const entry of entries) {
		if (!ENCRYPTION_KEY_PATTERN.test(entry)) {
			throw new EmDashSecretsError(
				`EMDASH_ENCRYPTION_KEY entry is malformed (expected "${ENCRYPTION_KEY_PREFIX}" followed by ${ENCRYPTION_KEY_BODY_LENGTH} base64url chars). Generate one with \`emdash secrets generate\`.`,
				"INVALID_ENCRYPTION_KEY",
			);
		}

		const body = entry.slice(ENCRYPTION_KEY_PREFIX.length);
		const key = decodeBase64urlStrict(body);
		if (!key) {
			throw new EmDashSecretsError(
				"EMDASH_ENCRYPTION_KEY body is not valid base64url",
				"INVALID_ENCRYPTION_KEY",
			);
		}
		if (key.length !== GENERATED_SECRET_BYTES) {
			throw new EmDashSecretsError(
				`EMDASH_ENCRYPTION_KEY must decode to ${GENERATED_SECRET_BYTES} bytes, got ${key.length}`,
				"INVALID_ENCRYPTION_KEY",
			);
		}

		const canonical = encodeBase64url(key);
		if (canonical !== body) {
			throw new EmDashSecretsError(
				"EMDASH_ENCRYPTION_KEY body is not canonical base64url. Generate one with `emdash secrets generate`.",
				"INVALID_ENCRYPTION_KEY",
			);
		}

		const kid = fingerprintKeyBytes(key);
		if (seenKids.has(kid)) {
			continue;
		}
		seenKids.add(kid);
		parsed.push({ kid, key, raw: entry });
	}

	return parsed;
}

export async function fingerprintKey(raw: string): Promise<string> {
	if (!ENCRYPTION_KEY_PATTERN.test(raw)) {
		throw new EmDashSecretsError(
			`Key must match "${ENCRYPTION_KEY_PREFIX}" followed by ${ENCRYPTION_KEY_BODY_LENGTH} base64url chars`,
			"INVALID_ENCRYPTION_KEY",
		);
	}
	const body = raw.slice(ENCRYPTION_KEY_PREFIX.length);
	const bytes = decodeBase64urlStrict(body);
	if (!bytes || bytes.length !== GENERATED_SECRET_BYTES || encodeBase64url(bytes) !== body) {
		throw new EmDashSecretsError(
			`Key body must decode to ${GENERATED_SECRET_BYTES} canonical base64url bytes`,
			"INVALID_ENCRYPTION_KEY",
		);
	}
	return fingerprintKeyBytes(bytes);
}

function fingerprintKeyBytes(key: Uint8Array): string {
	return encodeHexLowerCase(sha256(key)).slice(0, 8);
}

export function generateEncryptionKey(): string {
	const bytes = new Uint8Array(GENERATED_SECRET_BYTES);
	crypto.getRandomValues(bytes);
	return `${ENCRYPTION_KEY_PREFIX}${encodeBase64url(bytes)}`;
}

export async function resolveSecrets(options: ResolveSecretsOptions): Promise<ResolvedSecrets> {
	const env = options.env ?? readDefaultEnv();
	const repo = options._repo ?? new OptionsRepository(options.db);

	const previewEnvOverride = pickFirstNonEmpty(env.EMDASH_PREVIEW_SECRET, env.PREVIEW_SECRET);
	const ipSaltEnvOverride = pickFirstNonEmpty(
		env.EMDASH_IP_SALT,
		env.EMDASH_AUTH_SECRET,
		env.AUTH_SECRET,
	);

	const [previewSecret, ipSalt] = await Promise.all([
		previewEnvOverride !== null
			? Promise.resolve({ value: previewEnvOverride, source: "env" as const })
			: ensureGeneratedOption(repo, PREVIEW_SECRET_OPTION_KEY),
		ipSaltEnvOverride !== null
			? Promise.resolve({ value: ipSaltEnvOverride, source: "env" as const })
			: ensureGeneratedOption(repo, IP_SALT_OPTION_KEY),
	]);

	return {
		previewSecret: previewSecret.value,
		previewSecretSource: previewSecret.source,
		ipSalt: ipSalt.value,
		ipSaltSource: ipSalt.source,
	};
}

export async function validateEncryptionKeyAtStartup(env?: SecretsEnv): Promise<boolean> {
	const resolved = env ?? readDefaultEnv();
	try {
		await parseEncryptionKeys(resolved.EMDASH_ENCRYPTION_KEY);
		return true;
	} catch (error) {
		if (error instanceof EmDashSecretsError) {
			console.error(
				`[emdash] EMDASH_ENCRYPTION_KEY is invalid: ${error.message} ` +
					"Plugin-secret encryption will fail once it ships. " +
					"Generate a fresh key with `emdash secrets generate`.",
			);
			return false;
		}
		throw error;
	}
}

const SECRETS_CACHE_KEY = Symbol.for("@emdash-cms/core/secrets-cache@2");

interface SecretsCacheHolder {
	cache: WeakMap<Kysely<Database>, SingleFlightCache<ResolvedSecrets>>;
}

function getSecretsCache(): WeakMap<Kysely<Database>, SingleFlightCache<ResolvedSecrets>> {
	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- globalThis singleton pattern
	const holder = globalThis as Record<symbol, SecretsCacheHolder | undefined>;
	let entry = holder[SECRETS_CACHE_KEY];
	if (!entry) {
		entry = { cache: new WeakMap() };
		holder[SECRETS_CACHE_KEY] = entry;
	}
	return entry.cache;
}

export function resolveSecretsCached(db: Kysely<Database>): Promise<ResolvedSecrets> {
	const caches = getSecretsCache();
	let cache = caches.get(db);
	if (!cache) {
		cache = createSingleFlightCache<ResolvedSecrets>();
		caches.set(db, cache);
	}
	return singleFlightCached(cache, () => resolveSecrets({ db }), {
		anchor: (promise) => after(() => promise),
		ownerTimeoutMs: 30_000,
	});
}

export function _clearSecretsCacheForTesting(): void {
	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- globalThis singleton pattern
	const holder = globalThis as Record<symbol, SecretsCacheHolder | undefined>;
	holder[SECRETS_CACHE_KEY] = undefined;
}

async function ensureGeneratedOption(
	repo: OptionsRepository,
	optionKey: string,
): Promise<{ value: string; source: "db" }> {
	const existing = await repo.get<string>(optionKey);
	if (typeof existing === "string" && existing.length > 0) {
		return { value: existing, source: "db" };
	}

	const generated = generateRandomSecret();
	const inserted = await repo.setIfAbsent(optionKey, generated);
	if (inserted) {
		return { value: generated, source: "db" };
	}

	const winner = await repo.get<string>(optionKey);
	if (typeof winner !== "string" || winner.length === 0) {
		throw new EmDashSecretsError(
			`Failed to persist generated secret for "${optionKey}"`,
			"SECRET_PERSIST_FAILED",
		);
	}
	return { value: winner, source: "db" };
}

function generateRandomSecret(): string {
	const bytes = new Uint8Array(GENERATED_SECRET_BYTES);
	crypto.getRandomValues(bytes);
	return encodeBase64url(bytes);
}

function pickFirstNonEmpty(...values: (string | undefined)[]): string | null {
	for (const value of values) {
		if (typeof value === "string" && value.length > 0) {
			return value;
		}
	}
	return null;
}

const BASE64URL_CHARSET_PATTERN = /^[A-Za-z0-9_-]+$/;

function decodeBase64urlStrict(input: string): Uint8Array | null {
	if (!BASE64URL_CHARSET_PATTERN.test(input)) return null;
	try {
		return decodeBase64url(input);
	} catch {
		return null;
	}
}

function readDefaultEnv(): SecretsEnv {
	const proc = typeof process !== "undefined" && process.env ? process.env : {};

	return {
		EMDASH_ENCRYPTION_KEY: proc.EMDASH_ENCRYPTION_KEY,
		EMDASH_PREVIEW_SECRET: proc.EMDASH_PREVIEW_SECRET,
		PREVIEW_SECRET: proc.PREVIEW_SECRET,
		EMDASH_IP_SALT: proc.EMDASH_IP_SALT,
		EMDASH_AUTH_SECRET: proc.EMDASH_AUTH_SECRET,
		AUTH_SECRET: proc.AUTH_SECRET,
	};
}
