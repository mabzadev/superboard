export const pluginId = "supbrd-plugmod-flows";
export { FlowsProvider as Providers } from "./features/flows/FlowsContext.js";
export const views = {
	"superboard.flows": () => import("./views/superboard.flows.js"),
	"superboard.flows_components": () => import("./views/superboard.flows_components.js"),
	"superboard.flows_launchpad": () => import("./views/superboard.flows_launchpad.js"),
	"superboard.flows_settings_environments": () =>
		import("./views/superboard.flows_settings_environments.js"),
	"superboard.flows_settings_localization": () =>
		import("./views/superboard.flows_settings_localization.js"),
	"superboard.flows_settings_sdk": () => import("./views/superboard.flows_settings_sdk.js"),
	"superboard.flows_users": () => import("./views/superboard.flows_users.js"),
	"superboard.flows_users_by_id": () => import("./views/superboard.flows_users_by_id.js"),
	"superboard.flows_workflows": () => import("./views/superboard.flows_workflows.js"),
	"superboard.flows_workflows_by_id": () => import("./views/superboard.flows_workflows_by_id.js"),
};
