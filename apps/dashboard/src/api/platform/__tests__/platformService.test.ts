import { beforeEach, describe, expect, it, vi } from "vitest";

const requests = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@/lib/api", () => ({ GET: requests.get, POST: requests.post }));
vi.mock("@/lib/config", () => ({ config: { apiPath: "/api/v1" } }));

import {
  getPlatformAccountErasures,
  getPlatformLibraries,
} from "../platformService";

describe("platform library catalogue service", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads the administrator-only Git catalogue from the platform API", async () => {
    requests.get.mockResolvedValue({
      data: {
        data: {
          schemaVersion: 2,
          repository: "https://github.com/mbzadev/opengrow-platform",
          developmentBranch: "dev",
          releasePolicy: "immutable-tag",
          libraries: [
            {
              id: "flutterflow",
              license: "MIT",
              licensePath: "sdks/flutterflow/LICENSE",
              releaseStatus: "pending-release",
            },
          ],
          customCode: { widgets: [], actions: {}, referenceAdapters: {} },
        },
      },
    });
    await expect(getPlatformLibraries()).resolves.toMatchObject({
      releasePolicy: "immutable-tag",
      libraries: [
        { id: "flutterflow", license: "MIT", releaseStatus: "pending-release" },
      ],
    });
    expect(requests.get).toHaveBeenCalledWith("/api/v1/platform/libraries", {
      timeout: 10_000,
      maxRetries: 1,
    });
  });

  it("loads redacted account-erasure operations from the control plane", async () => {
    requests.get.mockResolvedValue({
      data: {
        data: [
          {
            id: "erase-1",
            projectRef: "vocostar",
            subjectReference: "0123456789ab",
            status: "processing",
          },
        ],
      },
    });

    await expect(getPlatformAccountErasures()).resolves.toEqual([
      expect.objectContaining({
        id: "erase-1",
        subjectReference: "0123456789ab",
      }),
    ]);
    expect(requests.get).toHaveBeenCalledWith(
      "/api/v1/platform/account-erasures?limit=50",
      { timeout: 10_000, maxRetries: 1 }
    );
  });
});
