import {
  signProjectContext,
  type InternalProjectContext,
  type ProjectEnvironment,
} from "@superboard/contracts/project-context";
import type { Env } from "../types";
import { flowsInternalToken } from "./flows-internal-auth";
import { isFlowsLegacyCutoverEnabled } from "./flows-cutover-state";
import { readTextLimited } from "./http-limits";

const MAX_FLOWS_COMMERCE_RESPONSE_BYTES = 256 * 1024;

export type FlowsCommerceInput = {
  projectId: number;
  instanceId: number;
  environment: ProjectEnvironment;
  placement: string;
  customerId: string;
  offeringIdentifier?: string | null;
  userProperties: Record<string, unknown>;
  requestId?: string;
};

/** Returns undefined only when this target has not cut over to Flows yet. */
export async function flowsCommercePresentation(
  env: Env,
  input: FlowsCommerceInput,
): Promise<Record<string, unknown> | null | undefined> {
  if (
    !env.FLOWS_MODULE ||
    !(await isFlowsLegacyCutoverEnabled(env.DB, input.projectId))
  ) return undefined;
  const token = flowsInternalToken(env);
  if (!token) throw new Error("Flows service credentials are unavailable");
  const projectRef = `${input.instanceId}-${input.environment === "test" ? "test" : "prod"}`;
  const pathname = `/internal/v1/projects/${projectRef}/commerce/resolve`;
  const context: InternalProjectContext = {
    module: "flows",
    method: "POST",
    pathname,
    projectId: input.projectId,
    projectRef,
    instanceId: input.instanceId,
    environment: input.environment,
    actorId: 0,
    role: "sdk",
    requestId: input.requestId ?? crypto.randomUUID(),
    issuedAt: Math.floor(Date.now() / 1_000),
  };
  const signature = await signProjectContext(context, token);
  const headers = new Headers({
    "content-type": "application/json",
    "x-internal-token": token,
    "x-project-id": String(context.projectId),
    "x-project-ref": context.projectRef,
    "x-instance-id": String(context.instanceId),
    "x-environment": context.environment,
    "x-actor-id": "0",
    "x-role": context.role,
    "x-request-id": context.requestId,
    "x-context-issued-at": String(context.issuedAt),
    "x-context-version": "1",
    "x-context-signature": signature,
  });
  const response = await env.FLOWS_MODULE.fetch(
    new Request(`https://flows.internal${pathname}`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        placement: input.placement,
        customer_id: input.customerId,
        environment: input.environment,
        offering_identifier: input.offeringIdentifier ?? undefined,
        user_properties: input.userProperties,
      }),
    }),
  );
  const responseText = await readTextLimited(
    response,
    MAX_FLOWS_COMMERCE_RESPONSE_BYTES,
    "Flows commerce response is too large",
  );
  if (!response.ok) {
    throw new Error(
      `Flows commerce resolution failed (${response.status})${responseText ? `: ${responseText.slice(0, 512)}` : ""}`,
    );
  }
  let payload: unknown;
  try {
    payload = JSON.parse(responseText) as unknown;
  } catch {
    throw new Error("Flows commerce response is not valid JSON");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Flows commerce response is invalid");
  }
  const data = (payload as Record<string, unknown>).data;
  if (data === null) return null;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Flows commerce response data is invalid");
  }
  return data as Record<string, unknown>;
}
