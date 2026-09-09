import { resolveEmailMessage, type EmailDesign } from "./email-studio.js";

type Condition = { field: string; operator: string; value?: unknown };
type Node = {
	id: string;
	type: string;
	condition?: Condition;
	delay_seconds?: number;
	attributes?: Record<string, unknown>;
	template_id?: string;
};
type Graph = {
	start_node_id: string;
	nodes: Node[];
	edges: Array<{ from: string; to: string; outcome: string }>;
};
export function evaluateJourneyCondition(value: unknown, condition: Condition): boolean {
	const actual = condition.field
		.split(".")
		.reduce<unknown>(
			(current, key) =>
				current && typeof current === "object"
					? (current as Record<string, unknown>)[key]
					: undefined,
			value,
		);
	const expected = condition.value;
	switch (condition.operator) {
		case "exists":
			return actual !== undefined && actual !== null && actual !== "";
		case "equals":
			return String(actual ?? "") === String(expected ?? "");
		case "not_equals":
			return String(actual ?? "") !== String(expected ?? "");
		case "contains":
			return String(actual ?? "")
				.toLowerCase()
				.includes(String(expected ?? "").toLowerCase());
		case "starts_with":
			return String(actual ?? "")
				.toLowerCase()
				.startsWith(String(expected ?? "").toLowerCase());
		case "in":
			return Array.isArray(expected) && expected.map(String).includes(String(actual ?? ""));
		case "greater_than":
			return Number(actual) > Number(expected);
		case "greater_or_equal":
			return Number(actual) >= Number(expected);
		case "less_than":
			return Number(actual) < Number(expected);
		case "less_or_equal":
			return Number(actual) <= Number(expected);
		default:
			return false;
	}
}
function jsonPatch(target: unknown, patch: unknown): unknown {
	if (!patch || typeof patch !== "object" || Array.isArray(patch)) return structuredClone(patch);
	const result =
		target && typeof target === "object" && !Array.isArray(target)
			? ({ ...target } as Record<string, unknown>)
			: {};
	for (const [key, value] of Object.entries(patch)) {
		if (["__proto__", "prototype", "constructor"].includes(key)) continue;
		if (value === null) delete result[key];
		else result[key] = jsonPatch(result[key], value);
	}
	return result;
}
export type JourneySimulationStep = {
	id: string;
	type: string;
	at: string;
	outcome: string;
	locale?: string;
	reason?: string;
};
export function simulateJourney(
	graph: Graph,
	input: Record<string, unknown>,
	templates: Record<string, { published: boolean; document?: EmailDesign }>,
	start = Date.now(),
): JourneySimulationStep[] {
	const context = structuredClone(input);
	const subscriber = (context.subscriber ?? {}) as Record<string, unknown>;
	const seen = new Set<string>();
	const steps: JourneySimulationStep[] = [];
	let id = graph.start_node_id;
	let time = start;
	while (id && steps.length < 200) {
		const node = graph.nodes.find((item) => item.id === id);
		if (!node || seen.has(id)) {
			steps.push({
				id,
				type: node?.type ?? "unknown",
				at: new Date(time).toISOString(),
				outcome: "invalid_path",
			});
			break;
		}
		seen.add(id);
		let outcome = "default";
		let locale: string | undefined;
		let reason: string | undefined;
		if (node.type === "branch")
			outcome =
				node.condition && evaluateJourneyCondition(context, node.condition) ? "true" : "false";
		if (node.type === "delay") time += Math.max(0, Number(node.delay_seconds) || 0) * 1000;
		if (node.type === "update_attribute") {
			subscriber.attributes = jsonPatch(subscriber.attributes, node.attributes ?? {});
			context.subscriber = subscriber;
		}
		if (node.type === "email") {
			const template = templates[node.template_id ?? ""];
			if (!template?.published) reason = "EMAIL_TEMPLATE_NOT_PUBLISHED";
			else if (subscriber.status !== "enabled" || subscriber.consent_status !== "confirmed")
				reason = "subscriber_not_eligible";
			else if (template.document) {
				const signal = context.signal as { properties?: Record<string, unknown> } | undefined;
				const message = resolveEmailMessage(template.document, {
					profile: {
						...(subscriber.attributes as Record<string, unknown>),
						name: subscriber.name,
						email: subscriber.email,
					},
					event: signal?.properties ?? context,
					unsubscribe_url: "https://preview.invalid/unsubscribe",
				});
				locale = message.status === "ready" ? message.locale : undefined;
				reason =
					message.status === "ready"
						? message.missing_variables.length
							? "EMAIL_VARIABLES_MISSING"
							: message.reason
						: message.reason;
			}
		}
		steps.push({
			id: node.id,
			type: node.type,
			at: new Date(time).toISOString(),
			outcome,
			locale,
			reason,
		});
		if (node.type === "exit") break;
		id =
			graph.edges.find((edge) => edge.from === node.id && edge.outcome === outcome)?.to ??
			graph.edges.find((edge) => edge.from === node.id && edge.outcome === "default")?.to ??
			"";
	}
	return steps;
}
