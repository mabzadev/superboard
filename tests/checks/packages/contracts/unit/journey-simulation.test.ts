import { expect, it } from "vitest";

import { simulateJourney } from "../../../../../packages/contracts/src/journey-simulation.js";

it("simulates updated attributes, branches and delays without modifying the input", () => {
	const profile = {
		subscriber: { status: "enabled", attributes: { plan: { paid: false, tier: "pro" } } },
	};
	const trace = simulateJourney(
		{
			start_node_id: "update",
			nodes: [
				{ id: "update", type: "update_attribute", attributes: { plan: { paid: true } } },
				{
					id: "branch",
					type: "branch",
					condition: { field: "subscriber.attributes.plan.paid", operator: "equals", value: true },
				},
				{ id: "wait", type: "delay", delay_seconds: 3600 },
				{ id: "exit", type: "exit" },
			],
			edges: [
				{ from: "update", to: "branch", outcome: "default" },
				{ from: "branch", to: "wait", outcome: "true" },
				{ from: "branch", to: "exit", outcome: "false" },
				{ from: "wait", to: "exit", outcome: "default" },
			],
		},
		profile,
		{},
		Date.parse("2026-09-08T10:00:00Z"),
	);
	expect(trace.map((step) => step.id)).toEqual(["update", "branch", "wait", "exit"]);
	expect(trace.at(-1)?.at).toBe("2026-09-08T11:00:00.000Z");
	expect(profile.subscriber.attributes.plan).toEqual({ paid: false, tier: "pro" });
});
