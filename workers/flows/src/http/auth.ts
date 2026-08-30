import type { MiddlewareHandler } from "hono";
import {
  configuredSecrets,
} from "@superboard/contracts/secret";
import {
  verifyInternalProjectContextRequest,
  type InternalProjectContext,
} from "@superboard/contracts/project-context";
import type { Env } from "../types";
import type { FlowProjectProvision } from "../projects/service";
import { failure } from "./errors";

export type FlowVariables = {
  project: InternalProjectContext;
  flowProject: FlowProjectProvision;
};
export type FlowApp = {
  Bindings: Env;
  Variables: FlowVariables;
};

export function requireProjectContext(): MiddlewareHandler<FlowApp> {
  return async (context, next) => {
    const verification = await verifyInternalProjectContextRequest(
      context.req.raw,
      configuredSecrets(
        context.env.INTERNAL_API_TOKEN,
        context.env.INTERNAL_API_TOKEN_PREVIOUS,
      ),
      "flows",
    );
    if (!verification.ok) {
      throw failure(verification.code, verification.message, 401);
    }
    context.set("project", verification.context);
    await next();
  };
}
