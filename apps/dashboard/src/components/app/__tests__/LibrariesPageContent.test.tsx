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
      schemaVersion: 2,
      repository: "https://github.com/mbzadev/opengrow-platform",
      developmentBranch: "dev",
      releasePolicy: "immutable-tag",
      libraries: [
        {
          id: "flutterflow",
          displayName: "OpenGrow FlutterFlow",
          ecosystem: "FlutterFlow",
          packageName: "opengrow_flutterflow",
          sourcePath: "sdks/flutterflow",
          license: "MIT",
          licensePath: "sdks/flutterflow/LICENSE",
          versionSource: "sdks/flutterflow/pubspec.yaml",
          sourceVersion: "2.2.5",
          latestReleaseVersion: "2.2.4",
          releaseRef: "sdk-flutterflow-v2.2.4",
          releaseStatus: "pending-release",
          install: "opengrow_flutterflow: immutable",
        },
      ],
      customCode: {
        schemaVersion: 1,
        owner: "opengrow-platform",
        policy: "canonical-source",
        sourceFiles: {},
        widgets: [],
        actions: {},
        streams: {},
        referenceAdapters: {},
      },
      flutterFlowLibrary: {
        schemaVersion: 1,
        owner: "opengrow-platform",
        displayName: "OpenGrow",
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

    expect(await screen.findByText("OpenGrow FlutterFlow")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "MIT license" })).toHaveAttribute(
      "href",
      "https://github.com/mbzadev/opengrow-platform/blob/dev/sdks/flutterflow/LICENSE"
    );
    expect(
      screen.getByRole("link", { name: /Version authority/i })
    ).toHaveAttribute(
      "href",
      "https://github.com/mbzadev/opengrow-platform/blob/dev/sdks/flutterflow/pubspec.yaml"
    );
  });

  it("shows whether the Git-owned FlutterFlow project can be updated", async () => {
    render(<LibrariesPageContent />);

    expect(
      await screen.findByText("FlutterFlow library project · OpenGrow")
    ).toBeInTheDocument();
    expect(screen.getByText("1 immutable tag pending")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open Git-owned DSL" })
    ).toHaveAttribute(
      "href",
      "https://github.com/mbzadev/opengrow-platform/blob/dev/tools/flutterflow-library/dsl/edit.dart"
    );
    expect(
      screen.getByRole("link", { name: "Open controlled update workflow" })
    ).toHaveAttribute(
      "href",
      "https://github.com/mbzadev/opengrow-platform/actions/workflows/sync-flutterflow-library.yml"
    );
  });
});
