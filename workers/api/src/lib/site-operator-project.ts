import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";

import type { AppVariables, Env } from "../types.js";
import { resolveAuthorizedProjectContext } from "./domain-modules.js";

export async function siteOperatorProject(
	c: Context<{ Bindings: Env; Variables: AppVariables }>,
	projectRef: string,
) {
	const signed = c.get("internalProject");
	if (signed) {
		if (signed.projectRef !== projectRef)
			throw new HTTPException(403, { message: "Project access denied" });
		const details = await c.env.DB.prepare(
			"SELECT name, identifier FROM projects WHERE id = ? AND instance_id = ? AND is_test = ?",
		)
			.bind(signed.projectId, signed.instanceId, signed.environment === "test" ? 1 : 0)
			.first<{ name: string; identifier: string }>();
		if (!details) throw new HTTPException(404, { message: "Project not found" });
		return {
			id: String(signed.projectId),
			externalId: projectRef,
			instanceId: signed.instanceId,
			isTest: signed.environment === "test",
			name: details.name,
			identifier: details.identifier,
			role: signed.role,
		};
	}
	const operator = c.get("siteOperator");
	if (!operator) return null;
	const project = await resolveAuthorizedProjectContext(c.env.DB, 0, projectRef, operator);
	if (!project.ok) throw new HTTPException(project.status, { message: project.message });
	const details = await c.env.DB.prepare("SELECT name, identifier FROM projects WHERE id = ?")
		.bind(project.context.projectId)
		.first<{ name: string; identifier: string }>();
	if (!details) throw new HTTPException(404, { message: "Project not found" });
	return {
		id: String(project.context.projectId),
		externalId: projectRef,
		instanceId: project.context.instanceId,
		isTest: project.context.environment === "test",
		name: details.name,
		identifier: details.identifier,
		role: project.context.role,
	};
}
