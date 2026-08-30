import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/config", () => ({
  config: {
    apiUrl: "https://api.example.test",
    clientId: "test-client",
    environment: "test",
    shortlinkUrl: "https://in.example.test",
    sdkUrl: "https://sdk.example.test",
  },
}));

import { sdkInstallCode } from "../SdkSetupWizard";

describe("SDK setup distribution contract", () => {
  it("uses the catalogue's published immutable iOS installation", () => {
    expect(sdkInstallCode("ios")).toEqual([
      {
        language: "swift",
        filename: "Package.swift",
        code:
          '.package(url: "https://github.com/mabzadev/superboard.git", exact: "1.0.3")',
      },
    ]);
  });

  it("configures npm authentication before the web install command", () => {
    const blocks = sdkInstallCode("web");

    expect(blocks.map(({ filename }) => filename)).toEqual([
      ".npmrc",
      "Terminal",
    ]);
    expect(blocks[0]?.code).toContain(
      "@mbzadev:registry=https://npm.pkg.github.com"
    );
    expect(blocks[0]?.code).toContain(
      "//npm.pkg.github.com/:_authToken=${OPENGROW_GITHUB_PACKAGES_TOKEN}"
    );
    expect(blocks[1]?.code).toBe(
      'test -n "${OPENGROW_GITHUB_PACKAGES_TOKEN:-}" \\\n  && npm install @mbzadev/opengrow-js-sdk@1.0.2'
    );
  });

  it("configures Maven credentials before the Android dependency", () => {
    const blocks = sdkInstallCode("android");

    expect(blocks.map(({ filename }) => filename)).toEqual([
      "settings.gradle.kts",
      "build.gradle.kts",
      "Terminal",
    ]);
    expect(blocks[0]?.code).toContain(
      'providers.environmentVariable("OPENGROW_GITHUB_PACKAGES_USER")'
    );
    expect(blocks[0]?.code).toContain(
      'providers.environmentVariable("OPENGROW_GITHUB_PACKAGES_TOKEN")'
    );
    expect(blocks[0]?.code).toContain(
      'url = uri("https://maven.pkg.github.com/mabzadev/superboard-platform")'
    );
    expect(blocks[1]?.code).toBe(
      'implementation("io.opengrow:opengrow-android-sdk:1.0.3")'
    );
    expect(blocks[2]?.code).toBe(
      'test -n "${OPENGROW_GITHUB_PACKAGES_USER:-}" \\\n  && test -n "${OPENGROW_GITHUB_PACKAGES_TOKEN:-}" \\\n  && ./gradlew assemble'
    );
  });

  it("never embeds a package token value", () => {
    const source = [...sdkInstallCode("web"), ...sdkInstallCode("android")]
      .map(({ code }) => code)
      .join("\n");

    expect(source).not.toMatch(/\b(?:ghp_|github_pat_)[A-Za-z0-9_]+\b/u);
  });
});
