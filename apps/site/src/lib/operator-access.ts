import { hasPermission, toRoleLevel } from "@emdash-cms/auth";

interface OperatorAccessUser {
	id: string;
	role: number;
	disabled?: boolean;
}

export function canAccessOperatorConsole(
	user: OperatorAccessUser | null | undefined,
): user is OperatorAccessUser {
	if (!user?.id || user.disabled) return false;
	try {
		const operator = { role: toRoleLevel(user.role) };
		return hasPermission(operator, "settings:manage") && hasPermission(operator, "plugins:manage");
	} catch {
		return false;
	}
}
