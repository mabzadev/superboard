import type { Env } from "../types";

type FlowsTokenEnv = Pick<Env, "FLOWS_INTERNAL_TOKEN" | "MODULE_INTERNAL_TOKEN">;

export function flowsInternalToken(env: FlowsTokenEnv): string | null {
	return env.FLOWS_INTERNAL_TOKEN?.trim() || env.MODULE_INTERNAL_TOKEN?.trim() || null;
}
