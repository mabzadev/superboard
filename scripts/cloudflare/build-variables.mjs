const chunkSize = 4000;
const maxChunks = 20;
const prefix = "superboard:chunks:v1:";
const largeVariables = new Set([
	"SUPERBOARD_TARGET_MANIFEST",
	"SUPERBOARD_INSTALLATION_KEYS",
	"INSTALLER_DEVELOPMENT_TARGET",
]);

async function checksum(value) {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function encodeBuildVariables(variables) {
	const result = {};
	for (const [name, entry] of Object.entries(variables)) {
		const bytes = new TextEncoder().encode(entry.value);
		if (bytes.length <= chunkSize) {
			result[name] = entry;
			continue;
		}
		if (!largeVariables.has(name)) throw new Error(`BUILD_VARIABLE_TOO_LARGE:${name}`);
		let binary = "";
		for (const byte of bytes) binary += String.fromCharCode(byte);
		const encoded = btoa(binary);
		const count = Math.ceil(encoded.length / chunkSize);
		if (count > maxChunks) throw new Error(`BUILD_VARIABLE_TOO_LARGE:${name}`);
		result[name] = { ...entry, value: `${prefix}${count}:${await checksum(entry.value)}` };
		for (let index = 0; index < count; index += 1)
			result[`${name}__PART_${index}`] = {
				...entry,
				value: encoded.slice(index * chunkSize, (index + 1) * chunkSize),
			};
	}
	if (Object.keys(result).length > 64) throw new Error("BUILD_VARIABLE_COUNT_EXCEEDED");
	return result;
}

export async function readBuildVariable(env, name) {
	const value = env[name];
	if (typeof value !== "string" || !value.startsWith(prefix)) return value;
	const match = value.slice(prefix.length).match(/^([1-9][0-9]*):([a-f0-9]{64})$/u);
	if (!largeVariables.has(name) || !match || Number(match[1]) > maxChunks)
		throw new Error(`BUILD_VARIABLE_INVALID:${name}`);
	let encoded = "";
	for (let index = 0; index < Number(match[1]); index += 1) {
		const part = env[`${name}__PART_${index}`];
		if (
			typeof part !== "string" ||
			!/^[A-Za-z0-9+/]+={0,2}$/u.test(part) ||
			part.length > chunkSize
		)
			throw new Error(`BUILD_VARIABLE_INCOMPLETE:${name}`);
		encoded += part;
	}
	const decoded = new TextDecoder("utf-8", { fatal: true }).decode(
		Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0)),
	);
	if ((await checksum(decoded)) !== match[2]) throw new Error(`BUILD_VARIABLE_CHECKSUM:${name}`);
	return decoded;
}
