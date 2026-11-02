import type { AuthProviderDescriptor } from "../types.js";

export function google(): AuthProviderDescriptor {
	return {
		id: "google",
		label: "Google",
		adminEntry: "emdash/auth/providers/google-admin",
	};
}
