export function isWebAuthnSecureContext(): boolean {
	return typeof window !== "undefined" && window.isSecureContext;
}

export function isPublicKeyCredentialConstructorAvailable(): boolean {
	return (
		typeof window !== "undefined" &&
		window.PublicKeyCredential !== undefined &&
		typeof window.PublicKeyCredential === "function"
	);
}

export function isPasskeyEnvironmentUsable(): boolean {
	return isWebAuthnSecureContext() && isPublicKeyCredentialConstructorAvailable();
}
