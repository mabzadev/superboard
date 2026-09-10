import { FlowRealtimeHub } from "../../../../../packages/plugins/supbrd-plug-journeys/flows/src/runtime/realtime-hub.js";
import { FlowUserRuntime } from "../../../../../packages/plugins/supbrd-plug-journeys/flows/src/runtime/user-runtime.js";
import type { Env } from "../../../../../packages/plugins/supbrd-plug-journeys/flows/src/types.js";
import { FlowMaintenanceExecution } from "../../../../../packages/plugins/supbrd-plug-journeys/flows/src/workflows/maintenance.js";
type Bindings = Env & { HEALTH_FLOWS_DB: D1Database; WORKFLOW_API_SERVICE: Env["API_SERVICE"] };
function flowBindings(env: Bindings): Env {
	return {
		...env,
		DB: env.HEALTH_FLOWS_DB,
		API_SERVICE: env.WORKFLOW_API_SERVICE,
		SITE_SERVICE: undefined,
		SITE_OPERATOR_BRIDGE_TOKEN: undefined,
		INTERNAL_API_TOKEN: "runtime-flows-secret",
		SUPERBOARD_PLUGIN_LIFECYCLE: "required",
	};
}
export class RetirementFlowUserRuntime extends FlowUserRuntime {
	constructor(state: DurableObjectState, env: Bindings) {
		super(state, flowBindings(env));
	}
}
export class RetirementFlowRealtimeHub extends FlowRealtimeHub {
	constructor(state: DurableObjectState, env: Bindings) {
		super(state, flowBindings(env));
	}
}
export class RetirementFlowMaintenanceExecution extends FlowMaintenanceExecution {
	constructor(ctx: ExecutionContext, env: Bindings) {
		super(ctx, flowBindings(env));
	}
}
