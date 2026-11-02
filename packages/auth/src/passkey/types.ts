import type { AuthenticatorTransport, DeviceType } from "../types.js";

export interface RegistrationOptions {
	challenge: string;
	rp: {
		name: string;
		id: string;
	};
	user: {
		id: string;
		name: string;
		displayName: string;
	};
	pubKeyCredParams: Array<{
		type: "public-key";
		alg: number;
	}>;
	timeout?: number;
	attestation?: "none" | "indirect" | "direct";
	authenticatorSelection?: {
		authenticatorAttachment?: "platform" | "cross-platform";
		residentKey?: "discouraged" | "preferred" | "required";
		requireResidentKey?: boolean;
		userVerification?: "discouraged" | "preferred" | "required";
	};
	excludeCredentials?: Array<{
		type: "public-key";
		id: string;
		transports?: AuthenticatorTransport[];
	}>;
}

export interface RegistrationResponse {
	id: string;
	rawId: string;
	type: "public-key";
	response: {
		clientDataJSON: string;
		attestationObject: string;
		transports?: AuthenticatorTransport[];
	};
	authenticatorAttachment?: "platform" | "cross-platform";
}

export interface VerifiedRegistration {
	credentialId: string;
	publicKey: Uint8Array;
	algorithm: number;
	counter: number;
	deviceType: DeviceType;
	backedUp: boolean;
	transports: AuthenticatorTransport[];
}

export interface AuthenticationOptions {
	challenge: string;
	rpId: string;
	timeout?: number;
	userVerification?: "discouraged" | "preferred" | "required";
	allowCredentials?: Array<{
		type: "public-key";
		id: string;
		transports?: AuthenticatorTransport[];
	}>;
}

export interface AuthenticationResponse {
	id: string;
	rawId: string;
	type: "public-key";
	response: {
		clientDataJSON: string;
		authenticatorData: string;
		signature: string;
		userHandle?: string;
	};
	authenticatorAttachment?: "platform" | "cross-platform";
}

export interface VerifiedAuthentication {
	credentialId: string;
	newCounter: number;
}

export interface ChallengeStore {
	set(challenge: string, data: ChallengeData): Promise<void>;
	get(challenge: string): Promise<ChallengeData | null>;
	delete(challenge: string): Promise<void>;
}

export interface ChallengeData {
	type: "registration" | "authentication";
	userId?: string;
	expiresAt: number;
}

export interface PasskeyConfig {
	rpName: string;
	rpId: string;
	origins: string[];
}
