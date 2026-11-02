import type { Permission, RoleLevel } from "@emdash-cms/auth";
import { hasPermission, canActOnOwn, hasScope } from "@emdash-cms/auth";

import { apiError } from "./error.js";

interface UserLike {
	id: string;
	role: RoleLevel;
}

export function canReadMediaUsageCount(
	user: UserLike | null | undefined,
	tokenScopes: string[] | undefined,
): boolean {
	return (
		hasPermission(user, "content:read_drafts") && (!tokenScopes || hasScope(tokenScopes, "admin"))
	);
}

export function requirePerm(
	user: UserLike | null | undefined,
	permission: Permission,
): Response | null {
	if (!user) {
		return apiError("UNAUTHORIZED", "Authentication required", 401);
	}
	if (!hasPermission(user, permission)) {
		return apiError("FORBIDDEN", "Insufficient permissions", 403);
	}
	return null;
}

export function requireOwnerPerm(
	user: UserLike | null | undefined,
	ownerId: string,
	ownPermission: Permission,
	anyPermission: Permission,
): Response | null {
	if (!user) {
		return apiError("UNAUTHORIZED", "Authentication required", 401);
	}
	if (!canActOnOwn(user, ownerId, ownPermission, anyPermission)) {
		return apiError("FORBIDDEN", "Insufficient permissions", 403);
	}
	return null;
}
