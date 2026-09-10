import { test, expect } from "../../../fixtures/site-browser/base-fixtures.js";
import { flowFixture, FLOW_SURVEY_ID } from "../../../fixtures/site-browser/flows.js";
import {
	evidence,
	operatorHeaders,
	ready,
	unique,
	unwrap,
} from "../../../fixtures/site-browser/site-api.js";

test("a real SDK user traverses the published graph and appears in native analytics", async ({
	authenticatedPage: page,
}) => {
	test.setTimeout(90000);
	const f = await flowFixture(page);
	const version = await f.request("POST", `/workflows/${f.workflow.id}/publish`, {
		migration_strategy: "finish-current",
		changelog: "SDK journey",
	});
	await f.request("POST", `/workflows/${f.workflow.id}/releases`, {
		environment_id: f.environment.id,
		version_id: version.id,
		active: true,
	});
	const userId = unique("sdk-browser-user");
	const context = { projectId: f.project, environment: f.environment.key, userId };
	const sdk = async (action: string, body: Record<string, unknown>) => {
		const response = await page.request.post(`/api/v1/flows/v2/sdk/${action}`, {
			headers: {
				...operatorHeaders("supbrd-plugmod-flows"),
				"x-superboard-flows-sdk-key": f.environment.sdk_key,
			},
			data: { ...context, ...body },
		});
		expect(response.status(), `SDK ${action}`).toBe(200);
		return unwrap(await response.json());
	};
	const first = await sdk("blocks", {
		userProperties: { plan: "pro", country: "CH", platform: "web" },
		language: "fr",
	});
	const card = first.blocks.find((block: { key: string }) => block.key === "welcome_card");
	expect(card.componentType).toBe("BasicsV2Card");
	const eventId = crypto.randomUUID();
	const transitioned = await sdk("events", {
		eventId,
		name: "transition",
		workflowId: f.workflow.id,
		blockId: card.id,
		blockStateId: card.blockStateId,
		propertyKey: "continue",
	});
	const survey = transitioned.updatedBlocks.find(
		(block: { key: string }) => block.key === "activation_survey",
	);
	expect(survey.survey.questions[0].id).toBe("question-rating");
	const surveyResult = await sdk("survey", {
		eventId: crypto.randomUUID(),
		workflowId: f.workflow.id,
		blockId: FLOW_SURVEY_ID,
		surveyId: FLOW_SURVEY_ID,
		blockStateId: survey.survey.blockStateId,
		url: "https://example.test/onboarding",
		questions: [{ questionId: "question-rating", textResponse: "5" }],
	});
	expect(surveyResult.success).toBe(true);
	await expect
		.poll(
			async () =>
				(await f.request("GET", `/workflows/${f.workflow.id}/analytics`)).totals.some(
					(item: { event_name: string; count: number }) =>
						item.event_name === "survey-submit" && Number(item.count) > 0,
				),
			{ timeout: 20000 },
		)
		.toBe(true);
	await ready(page, `/flows/workflows/${f.workflow.id}`);
	await page.getByRole("tab", { name: "Analytics", exact: true }).click();
	await expect(page.getByText("survey-submit", { exact: true }).first()).toBeVisible();
	await expect(page.getByText("Rating statistics", { exact: true })).toBeVisible();
	const users = (await f.request("GET", `/users?environment_id=${f.environment.id}`)).items;
	expect(users).toHaveLength(1);
	const hash = users[0].user_id_hash;
	await ready(page, "/flows/users");
	const search = page.getByPlaceholder("Search users by hash, locale, country or platform");
	await search.fill("absent-" + hash);
	await expect(page.getByRole("cell", { name: hash, exact: true })).toHaveCount(0);
	await search.fill(hash);
	const row = page.getByRole("row").filter({ hasText: hash });
	await expect(row).toBeVisible();
	await evidence(
		"supbrd-plugmod-flows",
		"superboard.flows_users",
		[hash, f.workflow.id],
		"A real SDK identify/transition/survey populated the user projection; filtering excluded then found the exact persisted hash.",
	);
	await row.getByRole("link", { name: "Open", exact: true }).click();
	await expect(page.getByText(f.workflow.name, { exact: true })).toBeVisible();
	await page.getByRole("tab", { name: "Activity", exact: true }).click();
	await expect(page.getByText("survey-submit", { exact: true }).first()).toBeVisible();
	await page.reload();
	await expect(page.getByText(f.workflow.name, { exact: true })).toBeVisible();
	await evidence(
		"supbrd-plugmod-flows",
		"superboard.flows_users_by_id",
		[hash, f.workflow.id],
		"Opened the SDK-created user's workflow history and survey event, then reloaded the same persisted detail.",
	);
	await ready(page, "/flows");
	await expect(
		page
			.getByRole("row")
			.filter({ hasText: f.environment.id.slice(0, 7) })
			.first(),
	).toBeVisible();
	await evidence(
		"supbrd-plugmod-flows",
		"superboard.flows",
		[f.workflow.id, eventId],
		"Overview recent activity displays the environment and normalized events emitted by the real published SDK workflow.",
	);
});
