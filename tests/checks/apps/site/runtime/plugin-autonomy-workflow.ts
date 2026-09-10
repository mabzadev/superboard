import { withPluginWorkflowLifecycle } from "@superboard/contracts/plugin-workflow";
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";

interface WorkflowTestEnv extends Cloudflare.Env {
	WORKFLOW_API_SERVICE: Fetcher;
}
export class PluginAutonomyWorkflow extends WorkflowEntrypoint<WorkflowTestEnv, { key: string }> {
	override async run(event: WorkflowEvent<{ key: string }>, originalStep: WorkflowStep) {
		const step = withPluginWorkflowLifecycle(
			{
				SUPERBOARD_PLUGIN_LIFECYCLE: "required",
				SUPERBOARD_INSTANCE_ID: this.env.SUPERBOARD_INSTANCE_ID,
				INTERNAL_API_TOKEN: "runtime-flows-secret",
				API_SERVICE: this.env.WORKFLOW_API_SERVICE,
			},
			originalStep,
			"FLOW_DELAY_EXECUTION",
			event.instanceId,
		);
		return step.do("persist-business-operation", async () => {
			await this.env.DB.prepare("INSERT INTO plugin_workflow_effects (id) VALUES (?)")
				.bind(event.payload.key)
				.run();
			return { id: event.payload.key };
		});
	}
}
