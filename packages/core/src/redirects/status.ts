export const REDIRECT_STATUSES = [301, 302, 307, 308] as const;

export const TERMINAL_STATUSES = [410, 451] as const;

export const REDIRECT_RULE_STATUSES: readonly number[] = [
	...REDIRECT_STATUSES,
	...TERMINAL_STATUSES,
];

export function isTerminalStatus(type: number): boolean {
	return (TERMINAL_STATUSES as readonly number[]).includes(type);
}
