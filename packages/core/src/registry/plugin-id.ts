const HASH_LENGTH = 16;

export const REGISTRY_PLUGIN_ID_LENGTH = 2 + HASH_LENGTH;

export const REGISTRY_PLUGIN_ID_PATTERN = /^r_[a-z2-7]{16}$/;

const BASE32_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

function base32Encode(bytes: Uint8Array): string {
	let bits = 0;
	let value = 0;
	let out = "";
	for (const byte of bytes) {
		value = (value << 8) | byte;
		bits += 8;
		while (bits >= 5) {
			bits -= 5;
			out += BASE32_ALPHABET[(value >>> bits) & 0x1f];
		}
	}
	if (bits > 0) {
		out += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
	}
	return out;
}

export async function makeRegistryPluginId(publisherDid: string, slug: string): Promise<string> {
	const did = publisherDid.trim();
	const s = slug.trim();
	if (!did) throw new Error("makeRegistryPluginId: publisherDid is required");
	if (!s) throw new Error("makeRegistryPluginId: slug is required");

	const input = `${did}\n${s}`;
	const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
	const encoded = base32Encode(new Uint8Array(hashBuffer));
	return `r_${encoded.slice(0, HASH_LENGTH)}`;
}

export function isRegistryPluginId(pluginId: string): boolean {
	return REGISTRY_PLUGIN_ID_PATTERN.test(pluginId);
}
