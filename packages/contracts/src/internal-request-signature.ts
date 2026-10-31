import { readBytesLimited } from "./request-body.js";
const signatureHeader = "X-SuperBoard-Task-Signature";
const timestampHeader = "X-SuperBoard-Task-Timestamp";
const signaturePattern = /^[a-f0-9]{64}$/u;

export async function signPluginTaskRequest(request: Request, secret: string): Promise<Headers> {
	if (!secret.trim()) throw new Error("PLUGIN_TASK_SECRET_REQUIRED");
	const timestamp = String(Math.floor(Date.now() / 1000));
	const key = await taskSigningKey(secret);
	const signature = await crypto.subtle.sign(
		"HMAC",
		key,
		await taskSignaturePayload(request, timestamp),
	);
	return new Headers({
		[timestampHeader]: timestamp,
		[signatureHeader]: hex(new Uint8Array(signature)),
		"Content-Type": "application/json",
	});
}

export async function verifyPluginTaskRequest(request: Request, secret: string): Promise<boolean> {
	const timestamp = request.headers.get(timestampHeader);
	const signature = request.headers.get(signatureHeader);
	if (!secret.trim() || !timestamp || !signature || !signaturePattern.test(signature)) return false;
	const issued = Number(timestamp);
	const now = Date.now() / 1000;
	if (!Number.isSafeInteger(issued) || issued > now + 5 || issued < now - 60) return false;
	const key = await taskSigningKey(secret);
	return crypto.subtle.verify(
		"HMAC",
		key,
		Uint8Array.from(signature.match(/.{2}/gu) ?? [], (pair) => Number.parseInt(pair, 16)),
		await taskSignaturePayload(request, timestamp),
	);
}

const taskKeys = new Map<string, Promise<CryptoKey>>();
function taskSigningKey(secret: string): Promise<CryptoKey> {
	let key = taskKeys.get(secret);
	if (!key) {
		if (taskKeys.size >= 16) taskKeys.clear();
		key = crypto.subtle.importKey(
			"raw",
			new TextEncoder().encode(secret),
			{ name: "HMAC", hash: "SHA-256" },
			false,
			["sign", "verify"],
		);
		key.catch(() => taskKeys.get(secret) === key && taskKeys.delete(secret));
		taskKeys.set(secret, key);
	}
	return key;
}

async function taskSignaturePayload(
	request: Request,
	timestamp: string,
): Promise<Uint8Array<ArrayBuffer>> {
	const url = new URL(request.url);
	const body = await readBytesLimited(request.clone(), 16384);
	const checksum = hex(new Uint8Array(await crypto.subtle.digest("SHA-256", body)));
	return new Uint8Array(
		new TextEncoder().encode(
			[
				"superboard.plugin-task.v1",
				timestamp,
				request.method,
				url.pathname,
				url.search,
				checksum,
			].join("\n"),
		),
	);
}
function hex(bytes: Uint8Array): string {
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
