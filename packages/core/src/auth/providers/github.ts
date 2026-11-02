import type { AuthProviderDescriptor } from "../types.js";

export function github(): AuthProviderDescriptor {
	return {
		id: "github",
		label: "GitHub",
		adminEntry: "emdash/auth/providers/github-admin",
	};
}
