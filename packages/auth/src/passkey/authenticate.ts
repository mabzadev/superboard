import {
	verifyECDSASignature,
	p256,
	decodeSEC1PublicKey,
	decodePKIXECDSASignature,
} from "@oslojs/crypto/ecdsa";
import {
	decodePKIXRSAPublicKey,
	verifyRSASSAPKCS1v15Signature,
	sha256ObjectIdentifier,
} from "@oslojs/crypto/rsa";
import { sha256 } from "@oslojs/crypto/sha2";
import { encodeBase64urlNoPadding, decodeBase64urlIgnorePadding } from "@oslojs/encoding";
import {
	parseAuthenticatorData,
	parseClientDataJSON,
	ClientDataType,
	createAssertionSignatureMessage,
	coseAlgorithmES256,
	coseAlgorithmRS256,
} from "@oslojs/webauthn";

import { generateToken } from "../tokens.js";
import type { Credential, AuthAdapter, User } from "../types.js";
import type {
	AuthenticationOptions,
	AuthenticationResponse,
	VerifiedAuthentication,
	ChallengeStore,
	PasskeyConfig,
} from "./types.js";

const CHALLENGE_TTL = 5 * 60 * 1000;

export type PasskeyAuthenticationErrorCode =
	| "credential_not_found"
	| "invalid_response"
	| "challenge_not_found"
	| "invalid_challenge_type"
	| "challenge_expired"
	| "invalid_client_data_type"
	| "invalid_origin"
	| "invalid_rp_id_hash"
	| "user_presence_not_verified"
	| "invalid_signature_counter"
	| "invalid_signature"
	| "unsupported_algorithm"
	| "user_not_found";

export class PasskeyAuthenticationError extends Error {
	constructor(
		public code: PasskeyAuthenticationErrorCode,
		message: string,
	) {
		super(message);
		this.name = "PasskeyAuthenticationError";
	}
}

function invalidPasskeyResponseError(): PasskeyAuthenticationError {
	return new PasskeyAuthenticationError("invalid_response", "Invalid passkey response");
}

function decodeAuthenticationResponse(response: AuthenticationResponse) {
	try {
		const clientDataJSON = decodeBase64urlIgnorePadding(response.response.clientDataJSON);
		const authenticatorData = decodeBase64urlIgnorePadding(response.response.authenticatorData);
		const signature = decodeBase64urlIgnorePadding(response.response.signature);
		const clientData = parseClientDataJSON(clientDataJSON);

		return { clientDataJSON, authenticatorData, signature, clientData };
	} catch {
		throw invalidPasskeyResponseError();
	}
}

function parseAuthenticationData(authenticatorData: Uint8Array) {
	try {
		return parseAuthenticatorData(authenticatorData);
	} catch {
		throw invalidPasskeyResponseError();
	}
}

function decodeAssertionSignature(signature: Uint8Array) {
	try {
		return decodePKIXECDSASignature(signature);
	} catch {
		throw invalidPasskeyResponseError();
	}
}

export async function generateAuthenticationOptions(
	config: PasskeyConfig,
	credentials: Credential[],
	challengeStore: ChallengeStore,
): Promise<AuthenticationOptions> {
	const challenge = generateToken();

	await challengeStore.set(challenge, {
		type: "authentication",
		expiresAt: Date.now() + CHALLENGE_TTL,
	});

	return {
		challenge,
		rpId: config.rpId,
		timeout: 60000,
		userVerification: "preferred",
		allowCredentials:
			credentials.length > 0
				? credentials.map((cred) => ({
						type: "public-key" as const,
						id: cred.id,
						transports: cred.transports,
					}))
				: undefined,
	};
}

export async function verifyAuthenticationResponse(
	config: PasskeyConfig,
	response: AuthenticationResponse,
	credential: Credential,
	challengeStore: ChallengeStore,
): Promise<VerifiedAuthentication> {
	const { clientDataJSON, authenticatorData, signature, clientData } =
		decodeAuthenticationResponse(response);

	if (clientData.type !== ClientDataType.Get) {
		throw new PasskeyAuthenticationError("invalid_client_data_type", "Invalid client data type");
	}

	const challengeString = encodeBase64urlNoPadding(clientData.challenge);
	const challengeData = await challengeStore.get(challengeString);
	if (!challengeData) {
		throw new PasskeyAuthenticationError("challenge_not_found", "Challenge not found or expired");
	}
	if (challengeData.type !== "authentication") {
		throw new PasskeyAuthenticationError("invalid_challenge_type", "Invalid challenge type");
	}
	if (challengeData.expiresAt < Date.now()) {
		await challengeStore.delete(challengeString);
		throw new PasskeyAuthenticationError("challenge_expired", "Challenge expired");
	}

	await challengeStore.delete(challengeString);

	if (!config.origins.includes(clientData.origin)) {
		throw new PasskeyAuthenticationError(
			"invalid_origin",
			`Invalid origin: ${clientData.origin} not in [${config.origins.join(", ")}]`,
		);
	}

	const authData = parseAuthenticationData(authenticatorData);

	if (!authData.verifyRelyingPartyIdHash(config.rpId)) {
		throw new PasskeyAuthenticationError("invalid_rp_id_hash", "Invalid RP ID hash");
	}

	if (!authData.userPresent) {
		throw new PasskeyAuthenticationError(
			"user_presence_not_verified",
			"User presence not verified",
		);
	}

	if (authData.signatureCounter !== 0 && authData.signatureCounter <= credential.counter) {
		throw new PasskeyAuthenticationError(
			"invalid_signature_counter",
			"Invalid signature counter - possible cloned authenticator",
		);
	}

	const signatureMessage = createAssertionSignatureMessage(authenticatorData, clientDataJSON);

	const publicKeyBytes =
		credential.publicKey instanceof Uint8Array
			? credential.publicKey
			: new Uint8Array(credential.publicKey);

	let signatureValid = false;
	const hash = sha256(signatureMessage);

	if (credential.algorithm === coseAlgorithmES256) {
		const ecdsaPublicKey = decodeSEC1PublicKey(p256, publicKeyBytes);
		const ecdsaSignature = decodeAssertionSignature(signature);
		signatureValid = verifyECDSASignature(ecdsaPublicKey, hash, ecdsaSignature);
	} else if (credential.algorithm === coseAlgorithmRS256) {
		const rsaPublicKey = decodePKIXRSAPublicKey(publicKeyBytes);
		signatureValid = verifyRSASSAPKCS1v15Signature(
			rsaPublicKey,
			sha256ObjectIdentifier,
			hash,
			signature,
		);
	} else {
		throw new PasskeyAuthenticationError(
			"unsupported_algorithm",
			`Unsupported credential algorithm: ${credential.algorithm}`,
		);
	}

	if (!signatureValid) {
		throw new PasskeyAuthenticationError("invalid_signature", "Invalid signature");
	}

	return {
		credentialId: response.id,
		newCounter: authData.signatureCounter,
	};
}

export async function authenticateWithPasskey(
	config: PasskeyConfig,
	adapter: AuthAdapter,
	response: AuthenticationResponse,
	challengeStore: ChallengeStore,
): Promise<User> {
	const credential = await adapter.getCredentialById(response.id);
	if (!credential) {
		throw new PasskeyAuthenticationError("credential_not_found", "Credential not found");
	}

	const verified = await verifyAuthenticationResponse(config, response, credential, challengeStore);

	await adapter.updateCredentialCounter(verified.credentialId, verified.newCounter);

	const user = await adapter.getUserById(credential.userId);
	if (!user) {
		throw new PasskeyAuthenticationError("user_not_found", "User not found");
	}

	return user;
}
