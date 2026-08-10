import { beforeEach, describe, expect, it, vi } from "vitest";

const requests = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@/lib/api", () => ({ GET: requests.get, POST: requests.post }));
vi.mock("@/lib/config", () => ({ config: { apiPath: "/api/v1" } }));

import {
  discardPlatformEmailDeadLetter,
  getPlatformAccountErasures,
  getPlatformEmailOperations,
  getPlatformLibraries,
  replayPlatformEmailDeadLetter,
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

  it("loads email operations and sends explicit DLQ decisions to the control plane", async () => {
    requests.get.mockResolvedValue({
      data: {
        generatedAt: "2026-08-10T10:00:00.000Z",
        queue: { backlogCount: 3, backlogBytes: 1024, oldestMessageAt: null },
        messages: [{ id: "mail-1", status: "failed" }],
        deadLetters: [{ id: "dead-letter-1", status: "quarantined" }],
      },
    });
    await expect(getPlatformEmailOperations()).resolves.toMatchObject({
      queue: { backlogCount: 3, backlogBytes: 1024 },
      messages: [{ id: "mail-1", status: "failed" }],
      deadLetters: [{ id: "dead-letter-1", status: "quarantined" }],
    });
    expect(requests.get).toHaveBeenCalledWith(
      "/api/v1/platform/email/operations?limit=50",
      { timeout: 10_000, maxRetries: 1 }
    );

    requests.post
      .mockResolvedValueOnce({
        data: {
          id: "dead-letter-1",
          status: "replayed",
          messageId: "mail-1",
        },
      })
      .mockResolvedValueOnce({
        data: { id: "dead-letter-2", status: "discarded" },
      });
    await expect(
      replayPlatformEmailDeadLetter("dead-letter-1")
    ).resolves.toMatchObject({ status: "replayed", messageId: "mail-1" });
    await expect(
      discardPlatformEmailDeadLetter("dead-letter-2")
    ).resolves.toMatchObject({ status: "discarded" });
    expect(requests.post).toHaveBeenNthCalledWith(
      1,
      "/api/v1/platform/email/dead-letters/dead-letter-1/replay",
      {},
      { retry: false, timeout: 15_000 }
    );
    expect(requests.post).toHaveBeenNthCalledWith(
      2,
      "/api/v1/platform/email/dead-letters/dead-letter-2/discard",
      {},
      { retry: false, timeout: 15_000 }
    );
  });
});
