import { describe, expect, it } from "vitest";
import { sha256 } from "../d1/helpers";
import {
  FLOW_SDK_KEY_HEADER,
  readFlowSdkCredential,
  verifyFlowSdkKey,
} from "./auth";

describe("Flows SDK credentials", () => {
  it("reads the canonical HTTP header", () => {
    expect(
      readFlowSdkCredential(
        new Request("https://flows.test/v2/sdk/blocks", {
          headers: { [FLOW_SDK_KEY_HEADER]: "environment-secret" },
        }),
        "42-test",
      ),
    ).toEqual({
      projectIdentifier: "42-test",
      sdkKey: "environment-secret",
    });
  });

  it("keeps original @flows packages compatible through a composite identifier", () => {
    expect(
      readFlowSdkCredential(
        new Request("https://flows.test/v2/sdk/blocks"),
        "42-test.environment-secret",
      ),
    ).toEqual({
      projectIdentifier: "42-test",
      sdkKey: "environment-secret",
    });
  });

  it("rejects missing or conflicting credentials", () => {
    expect(() =>
      readFlowSdkCredential(
        new Request("https://flows.test/v2/sdk/blocks"),
        "42-test",
      ),
    ).toThrow("Flows SDK credentials are invalid");
    expect(() =>
      readFlowSdkCredential(
        new Request("https://flows.test/v2/sdk/blocks?sdkKey=query-secret", {
          headers: { [FLOW_SDK_KEY_HEADER]: "another-secret" },
        }),
        "42-test",
      ),
    ).toThrow("Flows SDK credentials are invalid");
  });

  it("compares the derived hash without comparing plaintext credentials", async () => {
    const stored = await sha256("environment-secret");
    await expect(verifyFlowSdkKey("environment-secret", stored)).resolves.toBe(
      true,
    );
    await expect(verifyFlowSdkKey("wrong-secret", stored)).resolves.toBe(false);
    await expect(verifyFlowSdkKey("environment-secret", null)).resolves.toBe(
      false,
    );
  });
});
