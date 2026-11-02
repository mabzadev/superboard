import { toBase32 } from "@atcute/multibase";
import { sha256 } from "@oslojs/crypto/sha2";

const SHA256_CODE = 0x12;
const SHA256_LENGTH = 0x20;

export function sha256Multihash(bytes: Uint8Array): string {
	const digest = sha256(bytes);
	if (digest.length !== SHA256_LENGTH) {
		throw new Error(`expected sha256 digest to be ${SHA256_LENGTH} bytes, got ${digest.length}`);
	}
	const multihash = new Uint8Array(2 + digest.length);
	multihash[0] = SHA256_CODE;
	multihash[1] = SHA256_LENGTH;
	multihash.set(digest, 2);
	return `b${toBase32(multihash)}`;
}
