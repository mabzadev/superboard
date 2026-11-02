import * as React from "react";

import type { RolesSelectRow } from "../users/useRolesConfig.js";
import { useRolesConfig } from "../users/useRolesConfig.js";

const MAX_SELF_SIGNUP_DEFAULT_ROLE = 40;

export function useAllowedDomainsRolesConfig(): {
	getRoleLabel: (level: number) => string;
	signupRoles: readonly RolesSelectRow[];
	signupRoleItems: Record<string, string>;
} {
	const { roleLabels, getRoleLabel, roles } = useRolesConfig();

	const signupRoles = React.useMemo(
		() => roles.filter((r) => r.value <= MAX_SELF_SIGNUP_DEFAULT_ROLE),
		[roles],
	);

	const signupRoleItems = React.useMemo(() => {
		const entries: [string, string][] = signupRoles.map((r) => {
			const label = roleLabels[String(r.value)];
			return [String(r.value), label ?? getRoleLabel(r.value)];
		});
		return Object.fromEntries(entries);
	}, [signupRoles, roleLabels, getRoleLabel]);

	return { getRoleLabel, signupRoles, signupRoleItems };
}
