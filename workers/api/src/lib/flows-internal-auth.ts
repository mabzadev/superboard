import type { Env } from "../types";

type FlowsTokenEnv = Pick<
  Env,
  "FLOWS_INTERNAL_TOKEN" | "MODULE_INTERNAL_TOKEN"
>;

/**
 * Flows has a dedicated API-to-Worker credential. The platform module token is
 * accepted only as a bounded rollout fallback so the consumer can be deployed
 * before the new secret is present on both Workers.
 */
export function flowsInternalToken(env: FlowsTokenEnv): string | null {
  return (
    env.FLOWS_INTERNAL_TOKEN?.trim() ||
    env.MODULE_INTERNAL_TOKEN?.trim() ||
    null
  );
}
