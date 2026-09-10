import type { Page } from "@playwright/test";
import type { FlowGraph } from "@superboard/contracts/flows";

import { projectRef, siteApi, unique } from "./site-api.js";

export const FLOW_SURVEY_ID = "flow-survey-001";
export const initialGraph: FlowGraph = {
	schemaVersion: 1 as const,
	blocks: [
		{
			id: "flow-start-001",
			key: "eligible_users",
			type: "start",
			name: "Eligible users",
			description: "Starts automatically for matching product users.",
			position: { x: 80, y: 160 },
			data: {},
			propertyMeta: [],
			exitNodes: ["default"],
			conditions: [
				{
					key: "plan",
					data_type: "string",
					operator: "equals",
					value: ["pro"],
				},
			],
		},
		{
			id: "flow-card-001",
			key: "welcome_card",
			type: "component",
			name: "Welcome card",
			description: "Introduce the workspace and guide the first action.",
			componentType: "BasicsV2Card",
			componentLibraryName: "Basics V2",
			position: { x: 390, y: 80 },
			data: {
				componentKey: "card",
				componentVersion: 1,
				title: "Welcome to SuperBoard",
				body: "Create your first product experience.",
			},
			propertyMeta: [
				{
					key: "continue",
					type: "action",
					value: { type: "exit", target: "continue" },
				},
			],
			exitNodes: ["continue", "dismiss"],
			slottable: true,
			slotId: "dashboard-overlay",
			slotIndex: 0,
		},
		{
			id: FLOW_SURVEY_ID,
			key: "activation_survey",
			type: "survey",
			name: "Activation survey",
			description: "Capture activation feedback before completing.",
			componentType: "BasicsV2SurveyPopover",
			componentLibraryName: "Basics V2",
			position: { x: 730, y: 220 },
			data: {
				componentKey: "survey-popover",
				componentVersion: 1,
				title: "One last question",
			},
			propertyMeta: [],
			exitNodes: ["submit", "dismiss"],
			surveyQuestions: [
				{
					id: "question-rating",
					type: "rating",
					title: "How useful was this tour?",
					optional: false,
					displayType: "stars",
					minValue: 1,
					maxValue: 5,
				},
			],
		},
		{
			id: "flow-end-001",
			key: "completed",
			type: "end",
			name: "Completed",
			description: "Complete every active branch.",
			position: { x: 1080, y: 160 },
			data: {},
			propertyMeta: [],
			exitNodes: [],
		},
		{
			id: "flow-note-001",
			key: "editor_note",
			type: "note",
			name: "Activation notes",
			description: "Editor-only release checklist.",
			position: { x: 430, y: 390 },
			data: { text: "Verify the French copy before production." },
			propertyMeta: [],
			exitNodes: [],
			notes: "Verify the French copy before production.",
		},
	],
	paths: [
		{
			id: "path-start-card",
			sourceBlockId: "flow-start-001",
			sourceExitNode: "default",
			targetBlockId: "flow-card-001",
			label: "eligible",
		},
		{
			id: "path-card-survey",
			sourceBlockId: "flow-card-001",
			sourceExitNode: "continue",
			targetBlockId: FLOW_SURVEY_ID,
			label: "continue",
		},
		{
			id: "path-card-end",
			sourceBlockId: "flow-card-001",
			sourceExitNode: "dismiss",
			targetBlockId: "flow-end-001",
			label: "dismiss",
			triggerOnly: false,
		},
		{
			id: "path-survey-end",
			sourceBlockId: FLOW_SURVEY_ID,
			sourceExitNode: "submit",
			targetBlockId: "flow-end-001",
			label: "submit",
		},
	],
};

export async function flowFixture(
	page: Page,
	options: { name?: string; description?: string } = {},
) {
	const project = await projectRef(page);
	const suffix = unique("flow");
	const base = `/api/v1/flows/projects/${project}`;
	const request = (method: string, resource: string, body?: unknown) =>
		siteApi(page.request, "supbrd-plugmod-flows", method, base + resource, body);
	const library = await request("POST", "/component-libraries", {
		name: `Basics ${suffix}`,
		identifier: suffix,
	});
	const card = await request("POST", "/components", {
		library_id: library.id,
		name: `Card ${suffix}`,
		key: `card-${suffix}`,
		component_type: "BasicsV2Card",
		schema: { template_type: "component", properties: { title: { type: "string" } } },
		exit_nodes: ["continue", "dismiss"],
		css_variables: {},
	});
	const modal = await request("POST", "/components", {
		library_id: library.id,
		name: `Modal ${suffix}`,
		key: `modal-${suffix}`,
		component_type: "BasicsV2Modal",
		schema: { template_type: "component", properties: { title: { type: "string" } } },
		exit_nodes: ["continue", "close"],
		css_variables: {},
	});
	const survey = await request("POST", "/components", {
		library_id: library.id,
		name: `Survey ${suffix}`,
		key: `survey-${suffix}`,
		component_type: "BasicsV2SurveyPopover",
		schema: { template_type: "survey-component" },
		exit_nodes: ["submit", "dismiss"],
		css_variables: {},
	});
	const graph = structuredClone(initialGraph);
	for (const block of graph.blocks) {
		if (block.componentLibraryName) block.componentLibraryName = library.name;
		if (block.data.componentKey === "card") block.data.componentKey = card.key;
		if (block.data.componentKey === "survey-popover") block.data.componentKey = survey.key;
	}
	const workflow = await request("POST", "/workflows", {
		name: options.name ?? `First-run ${suffix}`,
		description: options.description,
		identifier: suffix,
		frequency: "every-time",
		origin: "user",
		graph,
	});
	const environment = await request("POST", "/environments", {
		name: `Production ${suffix}`,
		key: suffix,
		kind: "production",
		allow_draft: false,
	});
	return { project, workflow, environment, library, card, modal, survey, graph, request };
}
