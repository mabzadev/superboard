export function identityClaims(overrides: Record<string, unknown> = {}) {
	return {
		iss: "https://auth.example.com",
		sub: "test-user",
		azp: "test-client",
		aud: "test-client",
		exp: 4_000_000_000,
		iat: 1_700_000_000,
		email: "test@example.com",
		first_name: "Test",
		last_name: "User",
		locale: "en",
		...overrides,
	};
}
