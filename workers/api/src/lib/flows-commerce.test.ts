import { verifyInternalProjectContextRequest } from "@superboard/contracts/project-context";
import { describe, expect, it, vi } from "vitest";
import type { Env } from "../types";
import { createFakeD1 } from "../test/fake-d1";
import { flowsCommercePresentation } from "./flows-commerce";

describe("Flows commerce presentation binding", () => {
  it("uses a signed direct service binding and returns presentation only", async () => {
    const fetch = vi.fn(async (request: Request) => {
      await expect(
        verifyInternalProjectContextRequest(request, "internal-token", "flows"),
      ).resolves.toMatchObject({
        ok: true,
        context: {
          actorId: 0,
          role: "sdk",
          projectRef: "12-test",
          pathname: "/internal/v1/projects/12-test/commerce/resolve",
        },
      });
      await expect(request.json()).resolves.toMatchObject({
        placement: "main",
        customer_id: "customer-1",
        offering_identifier: "premium",
        environment: "test",
      });
      return Response.json({
        data: {
          id: "flow-1",
          configuration: { component_type: "superboard-commerce" },
        },
      });
    });
    const result = await flowsCommercePresentation(
      cutoverEnv({
        MODULE_INTERNAL_TOKEN: "platform-module-token",
        FLOWS_INTERNAL_TOKEN: "internal-token",
        FLOWS_MODULE: { fetch } as unknown as Fetcher,
      }),
      {
        projectId: 22,
        instanceId: 12,
        environment: "test",
        placement: "main",
        customerId: "customer-1",
        offeringIdentifier: "premium",
        userProperties: { platform: "ios" },
      },
    );
    expect(result).toMatchObject({ id: "flow-1" });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("uses the production project environment for production projects", async () => {
    const fetch = vi.fn(async (request: Request) => {
      await expect(request.json()).resolves.toMatchObject({
        environment: "production",
      });
      return Response.json({ data: null });
    });
    await expect(
      flowsCommercePresentation(
        cutoverEnv({
          FLOWS_INTERNAL_TOKEN: "internal-token",
          FLOWS_MODULE: { fetch } as unknown as Fetcher,
        }),
        {
          projectId: 22,
          instanceId: 12,
          environment: "production",
          placement: "main",
          customerId: "customer-1",
          userProperties: {},
        },
      ),
    ).resolves.toBeNull();
  });

  it("preserves the old authority only on targets without FLOWS_MODULE", async () => {
    await expect(
      flowsCommercePresentation({} as Env, {
        projectId: 22,
        instanceId: 12,
        environment: "production",
        placement: "main",
        customerId: "customer-1",
        userProperties: {},
      }),
    ).resolves.toBeUndefined();
  });

  it("preserves the old authority when Flows is staged but this project has not cut over", async () => {
    const fetch = vi.fn(async () => Response.json({ data: null }));
    await expect(
      flowsCommercePresentation(
        cutoverEnv(
          { FLOWS_MODULE: { fetch } as unknown as Fetcher },
          false,
        ),
        {
          projectId: 22,
          instanceId: 12,
          environment: "production",
          placement: "main",
          customerId: "customer-1",
          userProperties: {},
        },
      ),
    ).resolves.toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps the platform module token only as a rollout fallback", async () => {
    const fetch = vi.fn(async (request: Request) => {
      await expect(
        verifyInternalProjectContextRequest(request, "legacy-module-token", "flows"),
      ).resolves.toMatchObject({ ok: true });
      return Response.json({ data: null });
    });
    await expect(
      flowsCommercePresentation(
        cutoverEnv({
          MODULE_INTERNAL_TOKEN: "legacy-module-token",
          FLOWS_MODULE: { fetch } as unknown as Fetcher,
        }),
        {
          projectId: 22,
          instanceId: 12,
          environment: "test",
          placement: "main",
          customerId: "customer-1",
          userProperties: {},
        },
      ),
    ).resolves.toBeNull();
  });
});

function cutoverEnv(
  overrides: Partial<Env>,
  enabled = true,
): Env {
  return {
    DB: createFakeD1((call) => {
      if (call.sql.includes("FROM flows_legacy_cutover_state")) {
        expect(call.args).toEqual([22]);
        return enabled ? { enabled: 1 } : null;
      }
      throw new Error(`Unexpected D1 query: ${call.sql}`);
    }),
    ...overrides,
  } as Env;
}
