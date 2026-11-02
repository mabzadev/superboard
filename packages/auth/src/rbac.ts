import type { ApiTokenScope } from "./tokens.js";
import { Role, type RoleLevel } from "./types.js";

export const Permissions = {
	"content:read": Role.SUBSCRIBER,
	"content:read_drafts": Role.CONTRIBUTOR,
	"content:create": Role.CONTRIBUTOR,
	"content:edit_own": Role.AUTHOR,
	"content:edit_any": Role.EDITOR,
	"content:delete_own": Role.AUTHOR,
	"content:delete_any": Role.EDITOR,
	"content:delete_permanent": Role.ADMIN,
	"content:publish_own": Role.AUTHOR,
	"content:publish_any": Role.EDITOR,

	"media:read": Role.SUBSCRIBER,
	"media:upload": Role.CONTRIBUTOR,
	"media:edit_own": Role.AUTHOR,
	"media:edit_any": Role.EDITOR,
	"media:delete_own": Role.AUTHOR,
	"media:delete_any": Role.EDITOR,

	"taxonomies:read": Role.SUBSCRIBER,
	"taxonomies:manage": Role.EDITOR,

	"comments:read": Role.SUBSCRIBER,
	"comments:moderate": Role.EDITOR,
	"comments:delete": Role.ADMIN,
	"comments:settings": Role.ADMIN,

	"menus:read": Role.SUBSCRIBER,
	"menus:manage": Role.EDITOR,

	"bylines:read": Role.SUBSCRIBER,
	"bylines:manage": Role.EDITOR,

	"widgets:read": Role.SUBSCRIBER,
	"widgets:manage": Role.EDITOR,

	"sections:read": Role.SUBSCRIBER,
	"sections:manage": Role.EDITOR,

	"redirects:read": Role.EDITOR,
	"redirects:manage": Role.ADMIN,

	"users:read": Role.ADMIN,
	"users:invite": Role.ADMIN,
	"users:manage": Role.ADMIN,

	"settings:read": Role.EDITOR,
	"settings:manage": Role.ADMIN,

	"schema:read": Role.EDITOR,
	"schema:manage": Role.ADMIN,

	"plugins:read": Role.EDITOR,
	"plugins:manage": Role.ADMIN,

	"import:execute": Role.ADMIN,

	"backups:manage": Role.ADMIN,

	"search:read": Role.SUBSCRIBER,
	"search:manage": Role.ADMIN,

	"auth:manage_own_credentials": Role.SUBSCRIBER,
	"auth:manage_connections": Role.ADMIN,
} as const;

export type Permission = keyof typeof Permissions;

export function hasPermission(
	user: { role: RoleLevel } | null | undefined,
	permission: Permission,
): boolean {
	if (!user) return false;
	return user.role >= Permissions[permission];
}

export function requirePermission(
	user: { role: RoleLevel } | null | undefined,
	permission: Permission,
): asserts user is { role: RoleLevel } {
	if (!user) {
		throw new PermissionError("unauthorized", "Authentication required");
	}
	if (!hasPermission(user, permission)) {
		throw new PermissionError("forbidden", `Missing permission: ${permission}`);
	}
}

export function canActOnOwn(
	user: { role: RoleLevel; id: string } | null | undefined,
	ownerId: string,
	ownPermission: Permission,
	anyPermission: Permission,
): boolean {
	if (!user) return false;
	if (ownerId !== "" && user.id === ownerId) {
		return hasPermission(user, ownPermission);
	}
	return hasPermission(user, anyPermission);
}

export function requirePermissionOnResource(
	user: { role: RoleLevel; id: string } | null | undefined,
	ownerId: string,
	ownPermission: Permission,
	anyPermission: Permission,
): asserts user is { role: RoleLevel; id: string } {
	if (!user) {
		throw new PermissionError("unauthorized", "Authentication required");
	}
	if (!canActOnOwn(user, ownerId, ownPermission, anyPermission)) {
		throw new PermissionError("forbidden", `Missing permission: ${anyPermission}`);
	}
}

export class PermissionError extends Error {
	constructor(
		public code: "unauthorized" | "forbidden",
		message: string,
	) {
		super(message);
		this.name = "PermissionError";
	}
}

const SCOPE_MIN_ROLE: Record<Exclude<ApiTokenScope, `mcp:tools:${string}`>, RoleLevel> = {
	"content:read": Role.SUBSCRIBER,
	"content:write": Role.CONTRIBUTOR,
	"media:read": Role.SUBSCRIBER,
	"media:write": Role.CONTRIBUTOR,
	"schema:read": Role.EDITOR,
	"schema:write": Role.ADMIN,
	"taxonomies:manage": Role.EDITOR,
	"menus:manage": Role.EDITOR,
	"settings:read": Role.EDITOR,
	"settings:manage": Role.ADMIN,
	"mcp:tools": Role.ADMIN,
	admin: Role.ADMIN,
};

export function scopesForRole(role: RoleLevel): ApiTokenScope[] {
	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- Object.entries loses tuple types; SCOPE_MIN_ROLE keys are ApiTokenScope by construction
	const entries = Object.entries(SCOPE_MIN_ROLE) as [ApiTokenScope, RoleLevel][];
	return entries.reduce<ApiTokenScope[]>((acc, [scope, minRole]) => {
		if (role >= minRole) acc.push(scope);
		return acc;
	}, []);
}

export function clampScopes(requested: string[], role: RoleLevel): string[] {
	const allowed = new Set<string>(scopesForRole(role));
	return requested.filter(
		(scope) => allowed.has(scope) || (scope.startsWith("mcp:tools:") && role >= Role.SUBSCRIBER),
	);
}
