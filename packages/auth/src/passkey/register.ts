import { ECDSAPublicKey, p256 } from "@oslojs/crypto/ecdsa";
import { RSAPublicKey } from "@oslojs/crypto/rsa";
import { encodeBase64urlNoPadding, decodeBase64urlIgnorePadding } from "@oslojs/encoding";
import {
	parseAttestationObject,
	parseClientDataJSON,
	coseAlgorithmES256,
	coseAlgorithmRS256,
	coseEllipticCurveP256,
	ClientDataType,
	COSEKeyType,
} from "@oslojs/webauthn";

import { generateToken } from "../tokens.js";
import type { Credential, NewCredential, AuthAdapter, User, DeviceType } from "../types.js";
import type {
	RegistrationOptions,
	RegistrationResponse,
	VerifiedRegistration,
	ChallengeStore,
	PasskeyConfig,
} from "./types.js";

const CHALLENGE_TTL = 5 * 60 * 1000;

export type { PasskeyConfig };

export async function generateRegistrationOptions(
	config: PasskeyConfig,
	user: Pick<User, "id" | "email" | "name">,
	existingCredentials: Credential[],
	challengeStore: ChallengeStore,
): Promise<RegistrationOptions> {
	const challenge = generateToken();

	await challengeStore.set(challenge, {
		type: "registration",
		userId: user.id,
		expiresAt: Date.now() + CHALLENGE_TTL,
	});

	const userIdBytes = new TextEncoder().encode(user.id);
	const userIdEncoded = encodeBase64urlNoPadding(userIdBytes);

	return {
		challenge,
		rp: {
			name: config.rpName,
			id: config.rpId,
		},
		user: {
			id: userIdEncoded,
			name: user.email,
			displayName: user.name || user.email,
		},
		pubKeyCredParams: [
			{ type: "public-key", alg: coseAlgorithmES256 },
			{ type: "public-key", alg: coseAlgorithmRS256 },
		],
		timeout: 60000,
		attestation: "none",
		authenticatorSelection: {
			residentKey: "preferred",
			userVerification: "preferred",
		},
		excludeCredentials: existingCredentials.map((cred) => ({
			type: "public-key" as const,
			id: cred.id,
			transports: cred.transports,
		})),
	};
}

export async function verifyRegistrationResponse(
	config: PasskeyConfig,
	response: RegistrationResponse,
	challengeStore: ChallengeStore,
): Promise<VerifiedRegistration> {
	const clientDataJSON = decodeBase64urlIgnorePadding(response.response.clientDataJSON);
	const attestationObject = decodeBase64urlIgnorePadding(response.response.attestationObject);

	const clientData = parseClientDataJSON(clientDataJSON);

	if (clientData.type !== ClientDataType.Create) {
		throw new Error("Invalid client data type");
	}

	const challengeString = encodeBase64urlNoPadding(clientData.challenge);
	const challengeData = await challengeStore.get(challengeString);
	if (!challengeData) {
		throw new Error("Challenge not found or expired");
	}
	if (challengeData.type !== "registration") {
		throw new Error("Invalid challenge type");
	}
	if (challengeData.expiresAt < Date.now()) {
		await challengeStore.delete(challengeString);
		throw new Error("Challenge expired");
	}

	await challengeStore.delete(challengeString);

	if (!config.origins.includes(clientData.origin)) {
		throw new Error(`Invalid origin: ${clientData.origin} not in [${config.origins.join(", ")}]`);
	}

	const attestation = parseAttestationObject(attestationObject);

	const { authenticatorData } = attestation;

	if (!authenticatorData.verifyRelyingPartyIdHash(config.rpId)) {
		throw new Error("Invalid RP ID hash");
	}

	if (!authenticatorData.userPresent) {
		throw new Error("User presence not verified");
	}

	if (!authenticatorData.credential) {
		throw new Error("No credential data in attestation");
	}

	const { credential } = authenticatorData;

	const algorithm = credential.publicKey.algorithm();
	let encodedPublicKey: Uint8Array;

	if (algorithm === coseAlgorithmES256) {
		if (credential.publicKey.type() !== COSEKeyType.EC2) {
			throw new Error("Expected EC2 key type for ES256");
		}
		const cosePublicKey = credential.publicKey.ec2();
		if (cosePublicKey.curve !== coseEllipticCurveP256) {
			throw new Error("Expected P-256 curve for ES256");
		}
		encodedPublicKey = new ECDSAPublicKey(
			p256,
			cosePublicKey.x,
			cosePublicKey.y,
		).encodeSEC1Uncompressed();
	} else if (algorithm === coseAlgorithmRS256) {
		if (credential.publicKey.type() !== COSEKeyType.RSA) {
			throw new Error("Expected RSA key type for RS256");
		}
		const cosePublicKey = credential.publicKey.rsa();
		encodedPublicKey = new RSAPublicKey(cosePublicKey.n, cosePublicKey.e).encodePKIX();
	} else {
		throw new Error(`Unsupported credential algorithm: ${algorithm}`);
	}

	const deviceType: DeviceType = "singleDevice";
	const backedUp = false;

	return {
		credentialId: response.id,
		publicKey: encodedPublicKey,
		algorithm,
		counter: authenticatorData.signatureCounter,
		deviceType,
		backedUp,
		transports: response.response.transports ?? [],
	};
}

export async function registerPasskey(
	adapter: AuthAdapter,
	userId: string,
	verified: VerifiedRegistration,
	name?: string,
): Promise<Credential> {
	const count = await adapter.countCredentialsByUserId(userId);
	if (count >= 10) {
		throw new Error("Maximum number of passkeys reached (10)");
	}

	const existing = await adapter.getCredentialById(verified.credentialId);
	if (existing) {
		throw new Error("Credential already registered");
	}

	const newCredential: NewCredential = {
		id: verified.credentialId,
		userId,
		publicKey: verified.publicKey,
		algorithm: verified.algorithm,
		counter: verified.counter,
		deviceType: verified.deviceType,
		backedUp: verified.backedUp,
		transports: verified.transports,
		name,
	};

	return adapter.createCredential(newCredential);
}
