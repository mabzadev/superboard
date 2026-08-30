export function toOwnedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	const owned = new Uint8Array(bytes.byteLength);
	owned.set(bytes);
	return owned.buffer;
}
