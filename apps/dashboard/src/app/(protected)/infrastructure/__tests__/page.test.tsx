import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlatformStatus } from "@/api/platform/platformService";

const platform = vi.hoisted(() => ({
  getStatus: vi.fn(),
  getJobs: vi.fn(),
  getErasures: vi.fn(),
  retryJob: vi.fn(),
}));

vi.mock("@/api/platform/platformService", () => ({
  getPlatformStatus: platform.getStatus,
  getPlatformCustomJobs: platform.getJobs,
  getPlatformAccountErasures: platform.getErasures,
  retryPlatformCustomJob: platform.retryJob,
}));

import InfrastructurePage from "../page";

describe("InfrastructurePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    platform.getStatus.mockResolvedValue(statusFixture());
    platform.getJobs.mockResolvedValue({
      jobs: [
        {
          id: "conversion-job-1",
          capability: "vocostar.media.convert",
          status: "failed",
          progress: 0.4,
          attempts: 2,
          updatedAt: "2026-08-09T08:30:00.000Z",
        },
        {
          id: "acceptance-job-1",
          capability: "reference.acceptance",
          status: "completed",
          attempts: 1,
          updatedAt: "2026-08-09T08:45:00.000Z",
          result: {
            acceptance: {
              decision: "accepted",
              platformRevision: "a".repeat(40),
              referenceRevision: "b".repeat(40),
            },
          },
        },
      ],
      nextCursor: null,
    });
    platform.getErasures.mockResolvedValue([
      {
        id: "erase-operation-123456789",
        projectId: 20,
        projectRef: "vocostar",
        subjectReference: "0123456789ab",
        status: "failed",
        completedSteps: ["app", "marketing"],
        attempts: 3,
        lastErrorCode: "support_unavailable",
        lastErrorService: "support",
        requestedAt: "2026-08-10T08:00:00.000Z",
        updatedAt: "2026-08-10T08:03:00.000Z",
        completedAt: null,
      },
    ]);
    platform.retryJob.mockResolvedValue({
      id: "conversion-job-1",
      capability: "vocostar.media.convert",
      status: "dispatched",
    });
  });

  it("shows live endpoints, Worker purpose, stores, metrics and custom jobs", async () => {
    render(<InfrastructurePage />);

    expect(await screen.findByText("Infrastructure")).toBeInTheDocument();
    expect(screen.getAllByText("125")).toHaveLength(3);
    expect(screen.getAllByText("4,200")).toHaveLength(2);
    expect(
      screen.getByRole("link", { name: /https:\/\/api\.example\.test/i })
    ).toHaveAttribute("href", "https://api.example.test");
    expect(screen.getByText("Reference acceptance app")).toBeInTheDocument();
    expect(
      screen.getAllByText("Application users and federated sessions")
    ).toHaveLength(2);
    expect(
      screen.getByText("Transactional and marketing email delivery")
    ).toBeInTheDocument();
    expect(screen.getByText("OpenGrow gateway")).toBeInTheDocument();
    expect(
      screen.getByText("Access: Application identity or Dashboard session")
    ).toBeInTheDocument();
    expect(screen.getByText("/auth/*")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Target mbza-development · Environment development · Release abc123 · Public routing active"
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText("Application-specific conversion jobs")
    ).toBeInTheDocument();
    expect(screen.getByText("conversion-job-1")).toBeInTheDocument();
    expect(screen.getByText("40%")).toBeInTheDocument();
    expect(screen.getByText("Cancelled jobs")).toBeInTheDocument();
    expect(screen.getByText("Refunds pending")).toBeInTheDocument();
    expect(screen.getByText("Refunds applied")).toBeInTheDocument();
    expect(screen.getByText("Credits refunded")).toBeInTheDocument();
    expect(screen.getByText("27")).toBeInTheDocument();
    expect(
      screen.getByText(
        "accepted · platform aaaaaaaaaaaa · reference bbbbbbbbbbbb"
      )
    ).toBeInTheDocument();
    expect(screen.getByText("opengrow-api-dev")).toBeInTheDocument();
    expect(screen.getByText("Account erasure operations")).toBeInTheDocument();
    expect(screen.getByText("erase-operation-123456789")).toBeInTheDocument();
    expect(screen.getByText("0123456789ab")).toBeInTheDocument();
    expect(screen.getByText("app → marketing")).toBeInTheDocument();
    expect(
      screen.getByText("support: support_unavailable")
    ).toBeInTheDocument();
    expect(screen.getByText("Expected: 0001_identity.sql")).toBeInTheDocument();
    expect(
      screen.getByText("Applied: 0001_identity.sql · 1 total")
    ).toBeInTheDocument();
    expect(platform.getJobs).toHaveBeenCalledTimes(1);
    expect(platform.getErasures).toHaveBeenCalledTimes(1);
  });

  it("retries a failed application job and refreshes the job list", async () => {
    platform.getJobs
      .mockResolvedValueOnce({
        jobs: [
          {
            id: "conversion-job-1",
            capability: "vocostar.media.convert",
            status: "failed",
          },
        ],
        nextCursor: null,
      })
      .mockResolvedValueOnce({
        jobs: [
          {
            id: "conversion-job-1",
            capability: "vocostar.media.convert",
            status: "dispatched",
          },
        ],
        nextCursor: null,
      });
    render(<InfrastructurePage />);

    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));

    await waitFor(() =>
      expect(platform.retryJob).toHaveBeenCalledWith("conversion-job-1")
    );
    await waitFor(() => expect(platform.getJobs).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("dispatched")).toBeInTheDocument();
  });

  it("inspects reference receipts through the versioned custom protocol", async () => {
    const fixture = statusFixture();
    fixture.custom.manifest = {
      protocolVersion: 2,
      appKey: "mbza-development",
      service: "custom-reference",
      version: "1.1.0",
      description: "Reference acceptance receipts",
      capabilities: [
        {
          id: "reference.acceptance",
          description: "Revision-bound MBZA acceptance",
          mode: "request",
        },
      ],
    };
    platform.getStatus.mockResolvedValue(fixture);

    render(<InfrastructurePage />);

    expect(
      await screen.findByText("Reference acceptance receipts")
    ).toBeInTheDocument();
    expect(platform.getJobs).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText(
        "accepted · platform aaaaaaaaaaaa · reference bbbbbbbbbbbb"
      )
    ).toBeInTheDocument();
  });

  it("reports an unavailable control-plane API", async () => {
    platform.getStatus.mockRejectedValue(
      new Error("Infrastructure API unavailable")
    );
    render(<InfrastructurePage />);

    expect(await screen.findByText("Status unavailable")).toBeInTheDocument();
    expect(
      screen.getByText("Infrastructure API unavailable")
    ).toBeInTheDocument();
    expect(platform.getJobs).not.toHaveBeenCalled();
    expect(platform.getErasures).not.toHaveBeenCalled();
  });
});

function statusFixture(): PlatformStatus {
  return {
    status: "ok",
    environment: "development",
    generatedAt: "2026-08-09T09:00:00.000Z",
    responseTimeMs: 18,
    deployment: {
      target: "mbza-development",
      release: "abc123",
      publicRouting: "active",
    },
    endpoints: {
      api: "https://api.example.test",
      dashboard: "https://grow.example.test",
      files: "https://files.example.test",
      sdk: "https://sdk.example.test",
      shortLinks: "https://in.example.test",
      mcp: "https://mcp.example.test",
    },
    api: {
      status: "ok",
      description: "OpenGrow gateway",
      capabilities: [
        {
          id: "identity",
          description: "Application users and federated sessions",
          access: "Application identity or Dashboard session",
          entrypoints: ["/auth/*", "/api/v1/users/*"],
        },
      ],
    },
    publicSurfaces: [
      {
        id: "reference",
        url: "https://reference.example.test",
        status: "ok",
        description: "Reference acceptance app",
        responseTimeMs: 32,
        httpStatus: 200,
      },
    ],
    services: [
      {
        id: "email",
        status: "ok",
        description: "Transactional and marketing email delivery",
        responseTimeMs: 4,
      },
    ],
    dataStores: [
      {
        id: "identity",
        kind: "D1",
        owner: "identity",
        status: "ok",
        description: "Application users and federated sessions",
        schema: {
          status: "current",
          expectedMigration: "0001_identity.sql",
          latestMigration: "0001_identity.sql",
          appliedMigrationCount: 1,
        },
      },
    ],
    custom: {
      status: "ok",
      manifest: {
        protocolVersion: 2,
        appKey: "vocostar",
        service: "opengrow-custom-vocostar",
        version: "1.1.0",
        description: "Application-specific conversion jobs",
        capabilities: [
          {
            id: "vocostar.jobs.read",
            description: "Inspect conversion jobs",
            mode: "request",
          },
          {
            id: "vocostar.jobs.cancel",
            description: "Cancel undispatched conversion jobs",
            mode: "request",
          },
        ],
      },
      stats: {
        status: "ok",
        generatedAt: "2026-08-09T09:00:00.000Z",
        users: { total: 125, premium: 42, anonymous: 8 },
        jobs: { failed: 1, completed: 20 },
        capabilities: {},
        cancellations: {
          jobs: 3,
          refundsPending: 1,
          refundsApplied: 2,
          creditsRefunded: 27,
        },
      },
    },
    metrics: { users: 125, projects: 3 },
    jobs: { email: { queued: 2 }, custom: { failed: 1 } },
    runtime: {
      status: "ok",
      environment: "development",
      dataset: "opengrow_development",
      windowMinutes: 60,
      generatedAt: "2026-08-09T09:00:00.000Z",
      rows: [
        {
          service: "opengrow-api-dev",
          outcome: "ok",
          eventType: "fetch",
          invocations: 4_200,
          exceptions: 0,
          truncated: 0,
          averageCpuMs: 1.2,
          averageWallMs: 6.5,
          maximumCpuMs: 4.2,
          maximumWallMs: 18.1,
        },
      ],
    },
  };
}
