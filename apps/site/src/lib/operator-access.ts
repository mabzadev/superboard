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
		return hasPermission({ role: toRoleLevel(user.role) }, "settings:manage");
	} catch {
		return false;
	}
}
