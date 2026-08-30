import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import type { Env, FlowDelayPayload } from "../types";

export class FlowDelayExecution extends WorkflowEntrypoint<Env, FlowDelayPayload> {
  async run(
    event: Readonly<WorkflowEvent<FlowDelayPayload>>,
    step: WorkflowStep,
  ): Promise<{ resumed: boolean }> {
    await step.sleep("wait-for-flow-delay", Math.max(0, event.payload.delayMs));
    return step.do(
      "resume-user-runtime",
      {
        retries: { limit: 8, delay: "10 seconds", backoff: "exponential" },
        timeout: "2 minutes",
      },
      async () => {
        const runtime = this.env.FLOW_USER_RUNTIME.getByName(
          event.payload.runtimeName,
        );
        const result = await runtime.resumeDelay(event.payload);
        return { resumed: result !== null };
      },
    );
  }
}
