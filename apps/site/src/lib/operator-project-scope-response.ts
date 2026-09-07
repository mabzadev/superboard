import type { OperatorProjectScope } from "@superboard/contracts/site-operator";
import { z } from "zod";

const project = z.object({
	id: z.string().min(1),
	internal_id: z.string().min(1),
	name: z.string(),
	identifier: z.string(),
	is_test: z.boolean(),
	created_at: z.string(),
	updated_at: z.string(),
});
const scope = z
	.object({
		production_project_ref: z.string().min(1),
		test_project_ref: z.string().min(1),
		instance: z.object({
			id: z.string().min(1),
			name: z.string(),
			uri_scheme: z.string(),
			get_started_dismissed: z.boolean(),
			created_at: z.string(),
			updated_at: z.string(),
			production: project,
			test: project,
			projects: z.array(project),
		}),
		projects: z.array(project),
	})
	.refine(
		(value) =>
			value.production_project_ref === value.instance.production.id &&
			value.test_project_ref === value.instance.test.id,
	);

export async function parseOperatorProjectScopeResponse(
	response: Response,
): Promise<OperatorProjectScope> {
	const value: unknown = await response.json();
	if (!response.ok) {
		const parsed = z
			.object({ error: z.object({ message: z.string().optional(), code: z.string().optional() }) })
			.safeParse(value);
		throw new Error(
			parsed.success
				? (parsed.data.error.message ?? parsed.data.error.code ?? "Operator context is unavailable")
				: "Operator context is unavailable",
		);
	}
	const parsed = scope.safeParse(value);
	if (!parsed.success) throw new Error("Incomplete operator context");
	return parsed.data;
}
