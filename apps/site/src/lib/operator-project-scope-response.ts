import type {
	OperatorProjectScope,
	OperatorProjectSummary as Project,
} from "@superboard/contracts/site-operator";

// Hand-written guards keep a schema library out of the Front shell entry. They accept
// exactly the shapes the previous object schemas accepted and drop unknown keys.
type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
	typeof value === "object" && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === "string";
const isFilledString = (value: unknown): value is string => isString(value) && value.length > 0;

function parseProject(value: unknown): Project | null {
	if (
		!isRecord(value) ||
		!isFilledString(value.id) ||
		!isFilledString(value.internal_id) ||
		!isString(value.name) ||
		!isString(value.identifier) ||
		typeof value.is_test !== "boolean" ||
		!isString(value.created_at) ||
		!isString(value.updated_at)
	)
		return null;
	return {
		id: value.id,
		internal_id: value.internal_id,
		name: value.name,
		identifier: value.identifier,
		is_test: value.is_test,
		created_at: value.created_at,
		updated_at: value.updated_at,
	};
}

function parseProjects(value: unknown): Project[] | null {
	if (!Array.isArray(value)) return null;
	const projects: Project[] = [];
	for (const entry of value) {
		const project = parseProject(entry);
		if (!project) return null;
		projects.push(project);
	}
	return projects;
}

function parseScope(value: unknown): OperatorProjectScope | null {
	if (
		!isRecord(value) ||
		!isFilledString(value.production_project_ref) ||
		!isFilledString(value.test_project_ref) ||
		!isRecord(value.instance)
	)
		return null;
	const instance = value.instance;
	if (
		!isFilledString(instance.id) ||
		!isString(instance.name) ||
		!isString(instance.uri_scheme) ||
		typeof instance.get_started_dismissed !== "boolean" ||
		!isString(instance.created_at) ||
		!isString(instance.updated_at)
	)
		return null;
	const production = parseProject(instance.production);
	const test = parseProject(instance.test);
	const instanceProjects = parseProjects(instance.projects);
	const projects = parseProjects(value.projects);
	if (!production || !test || !instanceProjects || !projects) return null;
	if (value.production_project_ref !== production.id || value.test_project_ref !== test.id)
		return null;
	return {
		production_project_ref: value.production_project_ref,
		test_project_ref: value.test_project_ref,
		instance: {
			id: instance.id,
			name: instance.name,
			uri_scheme: instance.uri_scheme,
			get_started_dismissed: instance.get_started_dismissed,
			created_at: instance.created_at,
			updated_at: instance.updated_at,
			production,
			test,
			projects: instanceProjects,
		},
		projects,
	};
}

function errorMessage(value: unknown): string | null {
	if (!isRecord(value) || !isRecord(value.error)) return null;
	const { message, code } = value.error;
	if ((message !== undefined && !isString(message)) || (code !== undefined && !isString(code)))
		return null;
	return message ?? code ?? "Operator context is unavailable";
}

export async function parseOperatorProjectScopeResponse(
	response: Response,
): Promise<OperatorProjectScope> {
	const value: unknown = await response.json();
	if (!response.ok) {
		throw new Error(errorMessage(value) ?? "Operator context is unavailable");
	}
	const scope = parseScope(value);
	if (!scope) throw new Error("Incomplete operator context");
	return scope;
}
