import { canonicalizeReleasePayload } from "@superboard/supbrd-core";

export async function snapshotPluginObjectStores(input: {
	r2: R2Bucket;
	kv: KVNamespace;
	r2_keys: string[];
	kv_keys: string[];
}) {
	const r2 = [];
	for (const key of input.r2_keys.toSorted()) {
		const object = await input.r2.get(key);
		if (!object) throw new Error(`R2_BACKUP_OBJECT_MISSING:${key}`);
		r2.push({ key, value: bytesToBase64(new Uint8Array(await object.arrayBuffer())) });
	}
	const kv = [];
	for (const key of input.kv_keys.toSorted()) {
		const value = await input.kv.get(key);
		if (value === null) throw new Error(`KV_BACKUP_VALUE_MISSING:${key}`);
		kv.push({ key, value });
	}
	const payload = { schema_version: 1, r2, kv };
	return { ...payload, checksum: await sha256(canonicalizeReleasePayload(payload)) };
}

export async function restorePluginObjectStores(input: {
	snapshot: Awaited<ReturnType<typeof snapshotPluginObjectStores>>;
	r2: R2Bucket;
	kv: KVNamespace;
	target_prefix: string;
}) {
	const { checksum, ...payload } = input.snapshot;
	if ((await sha256(canonicalizeReleasePayload(payload))) !== checksum) {
		throw new Error("OBJECT_STORE_SNAPSHOT_CHECKSUM_MISMATCH");
	}
	for (const object of input.snapshot.r2) {
		await input.r2.put(`${input.target_prefix}${object.key}`, base64ToBytes(object.value));
	}
	for (const entry of input.snapshot.kv) {
		await input.kv.put(`${input.target_prefix}${entry.key}`, entry.value);
	}
	return {
		r2_count: input.snapshot.r2.length,
		kv_count: input.snapshot.kv.length,
		checksum,
		production_mutated: false,
	};
}

function bytesToBase64(bytes: Uint8Array): string {
	return btoa(String.fromCodePoint(...bytes));
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
	return Uint8Array.from(atob(value), (character) => character.codePointAt(0) ?? 0);
}

async function sha256(value: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
	return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
