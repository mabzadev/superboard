import { apiError } from "#api/error.js";

import { hasScope } from "./api-tokens.js";

export function requireScope(locals: { tokenScopes?: string[] }, scope: string): Response | null {
	if (!locals.tokenScopes) return null;

	if (hasScope(locals.tokenScopes, scope)) return null;

	return apiError("INSUFFICIENT_SCOPE", `Token lacks required scope: ${scope}`, 403);
}
