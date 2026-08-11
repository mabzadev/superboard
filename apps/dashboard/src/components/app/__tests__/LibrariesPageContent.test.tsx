import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPlatformLibraries: vi.fn(),
}));

vi.mock("@/api/platform/platformService", () => ({
  getPlatformLibraries: mocks.getPlatformLibraries,
}));

vi.mock("@/lib/Notifications", () => ({
  showSuccessNotification: vi.fn(),
}));

import LibrariesPageContent from "../LibrariesPageContent";

describe("LibrariesPageContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPlatformLibraries.mockResolvedValue({
      schemaVersion: 4,
      repository: "https://github.com/mbzadev/superboard-platform",
      developmentBranch: "dev",
      releasePolicy: "immutable-tag",
      libraries: [
        {
          id: "flutterflow",
          lifecycle: "active",
          displayName: "SuperBoard FlutterFlow",
          ecosystem: "FlutterFlow",
          packageName: "opengrow_flutterflow",
          sourcePath: "sdks/flutterflow",
          license: "MIT",
          licensePath: "sdks/flutterflow/LICENSE",
          versionSource: "sdks/flutterflow/pubspec.yaml",
          sourceVersion: "3.0.0",
          latestReleaseVersion: "2.2.5",
          releaseRef: "sdk-flutterflow-v2.2.5",
          releaseStatus: "pending-release",
          releaseSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          install: "opengrow_flutterflow: immutable",
          candidatePackageName: "superboard_flutterflow",
          candidateInstall: "superboard_flutterflow: candidate",
        },
        {
          id: "javascript",
          lifecycle: "archived",
          displayName: "OpenGrow JavaScript",
          ecosystem: "npm",
          packageName: "@mbzadev/opengrow-js-sdk",
          sourcePath: "sdks/javascript",
          license: "MIT",
          licensePath: "sdks/javascript/LICENSE",
          versionSource: "sdks/javascript/package.json",
          sourceVersion: "1.0.2",
          latestReleaseVersion: "1.0.2",
          releaseRef: "sdk-js-v1.0.2",
          releaseStatus: "released",
          releaseSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          install: "npm install @mbzadev/opengrow-js-sdk@1.0.2",
          distribution: {
            registryKind: "github-packages-npm",
            registry: "https://npm.pkg.github.com",
            publicMetadata: true,
            anonymousInstallable: false,
            authentication: {
              required: true,
              tokenEnvironmentVariable: "OPENGROW_GITHUB_PACKAGES_TOKEN",
            },
          },
        },
      ],
      customCode: {
        schemaVersion: 1,
        owner: "superboard-platform",
        policy: "canonical-source",
        sourceFiles: {},
        widgets: [],
        actions: {},
        streams: {},
        referenceAdapters: {},
      },
      flutterFlowLibrary: {
        schemaVersion: 1,
        owner: "superboard-platform",
        displayName: "SuperBoard",
        source: {
          path: "tools/flutterflow-library/dsl/edit.dart",
          testPath: "tools/flutterflow-library/test/app_test.dart",
          workflow: ".github/workflows/sync-flutterflow-library.yml",
        },
        remoteProject: {
          projectIdVariable: "FF_LIBRARY_PROJECT_ID",
          apiKeySecret: "FF_API_KEY",
          githubEnvironment: "flutterflow-library",
        },
        releasePolicy: "immutable-tag-only",
        dependencies: [
          {
            catalogId: "flutterflow",
            packageName: "opengrow_flutterflow",
            sourceVersion: "2.2.5",
            requiredRef: "sdk-flutterflow-v2.2.5",
          },
        ],
        libraryValues: [
          {
            name: "projectKey",
            key: "opengrow_project_key",
            type: "string",
            required: true,
          },
        ],
        actions: { identity: ["opengrowApplicationInitialize"] },
        forbiddenAppState: ["opengrowApplicationAccessToken"],
      },
    });
  });

  it("shows the package-local MIT licence beside source and version authority", async () => {
    render(<LibrariesPageContent />);

    expect(await screen.findByText("SuperBoard FlutterFlow")).toBeInTheDocument();
    const licenseLink = screen
      .getAllByRole("link", { name: "MIT license" })
      .find(
        (link) =>
          link.getAttribute("href") ===
          "https://github.com/mbzadev/superboard-platform/blob/dev/sdks/flutterflow/LICENSE"
      );
    expect(licenseLink).toHaveAttribute(
      "href",
      "https://github.com/mbzadev/superboard-platform/blob/dev/sdks/flutterflow/LICENSE"
    );
    const versionLink = screen
      .getAllByRole("link", { name: /Version authority/i })
      .find(
        (link) =>
          link.getAttribute("href") ===
          "https://github.com/mbzadev/superboard-platform/blob/dev/sdks/flutterflow/pubspec.yaml"
      );
    expect(versionLink).toHaveAttribute(
      "href",
      "https://github.com/mbzadev/superboard-platform/blob/dev/sdks/flutterflow/pubspec.yaml"
    );
  });

  it("shows whether the Git-owned FlutterFlow project can be updated", async () => {
    render(<LibrariesPageContent />);

    expect(
      await screen.findByText("FlutterFlow library project · SuperBoard")
    ).toBeInTheDocument();
    expect(screen.getByText("1 immutable tag pending")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open Git-owned DSL" })
    ).toHaveAttribute(
      "href",
      "https://github.com/mbzadev/superboard-platform/blob/dev/tools/flutterflow-library/dsl/edit.dart"
    );
    expect(
      screen.getByRole("link", { name: "Open controlled update workflow" })
    ).toHaveAttribute(
      "href",
      "https://github.com/mbzadev/superboard-platform/actions/workflows/sync-flutterflow-library.yml"
    );
  });

  it("does not present public package metadata as anonymous installation", async () => {
    render(<LibrariesPageContent />);

    expect(await screen.findByText("OpenGrow JavaScript")).toBeInTheDocument();
    expect(screen.getByText("Archived")).toBeInTheDocument();
    expect(screen.getByText("Public metadata")).toBeInTheDocument();
    expect(screen.getByText("Authentication required")).toBeInTheDocument();
    expect(
      screen.getByText("Anonymous install unavailable")
    ).toBeInTheDocument();
    expect(
      screen.getByText("OPENGROW_GITHUB_PACKAGES_TOKEN")
    ).toBeInTheDocument();
    expect(screen.getByText("https://npm.pkg.github.com")).toBeInTheDocument();
    expect(
      screen.getByText("Historical dependency")
    ).toBeInTheDocument();
  });

  it("shows the staged SuperBoard coordinate without replacing the release baseline", async () => {
    render(<LibrariesPageContent />);

    expect(await screen.findByText("superboard_flutterflow")).toBeInTheDocument();
    expect(screen.getByText("Migration candidate")).toBeInTheDocument();
    expect(screen.getByText("Release pending")).toBeInTheDocument();
    expect(
      screen.getAllByText("sdk-flutterflow-v2.2.5"),
    ).not.toHaveLength(0);
  });
});
