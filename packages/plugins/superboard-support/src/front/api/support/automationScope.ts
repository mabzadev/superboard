import type { SupportAutomation } from "./automationsService.js";

export function isInboxAutomation(automation: SupportAutomation, inboxId: string) {
	return (
		automation.condition_mode === "all" &&
		automation.conditions.some(
			(condition) =>
				condition.field === "inbox_id" &&
				condition.operator === "equals" &&
				condition.value === inboxId,
		)
	);
}

export function editableAutomationConditions(automation: SupportAutomation, inboxId?: string) {
	if (!inboxId || !isInboxAutomation(automation, inboxId))
		return { mode: automation.condition_mode, conditions: automation.conditions };
	const conditions = automation.conditions.filter(
		(condition) =>
			!(
				condition.field === "inbox_id" &&
				condition.operator === "equals" &&
				condition.value === inboxId
			),
	);
	const group = conditions.length === 1 ? conditions[0] : undefined;
	if (group && (group.mode === "all" || group.mode === "any") && Array.isArray(group.conditions))
		return { mode: group.mode, conditions: group.conditions };
	return { mode: "all" as const, conditions };
}
