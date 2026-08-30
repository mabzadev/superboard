import { describe, expect, it } from "vitest";
import {
  requireSupportRole,
  resolveSupportPrincipal,
  type SupportPrincipal,
} from "./access";

function database(result: unknown) {
  return {
    prepare: () => ({
      bind: () => ({ first: async () => result }),
    }),
  } as unknown as D1Database;
}

describe("Support role resolution", () => {
  it("keeps Identity owner/admin as project-wide overrides", async () => {
    await expect(resolveSupportPrincipal(database(null), {
      projectId: 12,
      actorId: 9,
      role: "owner",
    })).resolves.toMatchObject({
      supportRole: "owner",
      membershipId: null,
      actorId: "9",
    });
  });

  it("resolves members only through an active Support membership", async () => {
    await expect(resolveSupportPrincipal(database({ id: "membership-1", role: "supervisor" }), {
      projectId: 12,
      actorId: 9,
      role: "member",
    })).resolves.toMatchObject({
      supportRole: "supervisor",
      membershipId: "membership-1",
    });
    await expect(resolveSupportPrincipal(database(null), {
      projectId: 12,
      actorId: 9,
      role: "member",
    })).rejects.toMatchObject({ code: "support_membership_required", status: 403 });
  });

  it("enforces the native Support role hierarchy", () => {
    const principal = {
      actorId: "9",
      identityRole: "member",
      supportRole: "agent",
      membershipId: "membership-1",
      projectId: 12,
    } satisfies SupportPrincipal;
    expect(() => requireSupportRole(principal, "agent")).not.toThrow();
    expect(() => requireSupportRole(principal, "supervisor")).toThrowError(
      expect.objectContaining({ code: "support_role_insufficient", status: 403 }),
    );
  });
});
