import { z } from "zod";

import { GET, POST } from "./transport.js";

export async function operatorGet<T>(path: string): Promise<T> {
	return (await GET(path)).data.data;
}
export async function operatorPost<T>(path: string, body: unknown): Promise<T> {
	return (await POST(path, body)).data.data;
}

const descriptor = z.object({
	id: z.string(),
	type: z.literal("public-key"),
	transports: z.array(z.enum(["usb", "nfc", "ble", "internal", "hybrid"])).optional(),
});
const authentication = z.object({
	challenge: z.string(),
	rpId: z.string(),
	timeout: z.number().optional(),
	userVerification: z.enum(["discouraged", "preferred", "required"]).optional(),
	allowCredentials: z.array(descriptor).optional(),
});
const registration = z.object({
	challenge: z.string(),
	rp: z.object({ id: z.string(), name: z.string() }),
	user: z.object({ id: z.string(), name: z.string(), displayName: z.string() }),
	pubKeyCredParams: z.array(z.object({ type: z.literal("public-key"), alg: z.number() })),
	timeout: z.number().optional(),
	excludeCredentials: z.array(descriptor).optional(),
	authenticatorSelection: z
		.object({
			authenticatorAttachment: z.enum(["platform", "cross-platform"]).optional(),
			residentKey: z.enum(["discouraged", "preferred", "required"]).optional(),
			requireResidentKey: z.boolean().optional(),
			userVerification: z.enum(["discouraged", "preferred", "required"]).optional(),
		})
		.optional(),
	attestation: z.enum(["none", "indirect", "direct", "enterprise"]).optional(),
});

function decode(value: string): ArrayBuffer {
	const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
	return Uint8Array.from(
		atob(normalized + "=".repeat((4 - (normalized.length % 4)) % 4)),
		(character) => character.charCodeAt(0),
	).buffer;
}
function encode(value: ArrayBuffer): string {
	return btoa(String.fromCharCode(...new Uint8Array(value)))
		.replaceAll("+", "-")
		.replaceAll("/", "_");
}

export async function signInWithOperatorPasskey(): Promise<void> {
	const payload = await operatorPost<{ options: unknown }>("/_emdash/api/auth/passkey/options", {});
	const options = authentication.parse(payload.options);
	const credential = await navigator.credentials.get({
		publicKey: {
			...options,
			challenge: decode(options.challenge),
			allowCredentials: options.allowCredentials?.map((item) => ({ ...item, id: decode(item.id) })),
		},
	});
	if (
		!(credential instanceof PublicKeyCredential) ||
		!(credential.response instanceof AuthenticatorAssertionResponse)
	)
		throw new Error("Passkey authentication was cancelled");
	const response = credential.response;
	await operatorPost("/_emdash/api/auth/passkey/verify", {
		credential: {
			id: credential.id,
			rawId: encode(credential.rawId),
			type: "public-key",
			response: {
				clientDataJSON: encode(response.clientDataJSON),
				authenticatorData: encode(response.authenticatorData),
				signature: encode(response.signature),
				...(response.userHandle ? { userHandle: encode(response.userHandle) } : {}),
			},
		},
	});
}

export async function registerOperatorPasskey(
	optionsPath: string,
	completePath: string,
	body: { token?: string; name: string; email?: string },
): Promise<void> {
	const payload = await operatorPost<{ options: unknown }>(optionsPath, body);
	const options = registration.parse(payload.options);
	const credential = await navigator.credentials.create({
		publicKey: {
			...options,
			challenge: decode(options.challenge),
			user: { ...options.user, id: decode(options.user.id) },
			excludeCredentials: options.excludeCredentials?.map((item) => ({
				...item,
				id: decode(item.id),
			})),
		},
	});
	if (
		!(credential instanceof PublicKeyCredential) ||
		!(credential.response instanceof AuthenticatorAttestationResponse)
	)
		throw new Error("Passkey registration was cancelled");
	const response = credential.response;
	await operatorPost(completePath, {
		...body,
		credential: {
			id: credential.id,
			rawId: encode(credential.rawId),
			type: "public-key",
			response: {
				clientDataJSON: encode(response.clientDataJSON),
				attestationObject: encode(response.attestationObject),
				transports: response.getTransports(),
			},
		},
	});
}
