import type { Block, TourStep, TourStepType } from "../types";
import { filterVisibleBlocks } from "./blocks";
import { randomUUID } from "crypto";

const getTourStep = ({
  componentLibraryName,
  type,
}: {
  componentLibraryName?: string;
  type: TourStepType;
}): TourStep => ({
  id: randomUUID(),
  workflowId: randomUUID(),
  componentLibraryName,
  data: {},
  slottable: false,
  type,
  componentType: type === "tour-component" ? "Modal" : undefined,
});

const getBlock = ({
  blockStateId,
  componentLibraryName,
  tourBlocks,
}: {
  blockStateId?: string | undefined;
  tourBlocks?: TourStep[];
  componentLibraryName?: string;
}): Block => ({
  id: randomUUID(),
  workflowId: randomUUID(),
  componentLibraryName,
  blockStateId,
  data: {},
  exitNodes: [],
  slottable: false,
  type: tourBlocks ? "tour" : "component",
  componentType: tourBlocks ? undefined : "Modal",
  tourBlocks,
});

const consoleWarnMock = jest.spyOn(console, "warn").mockImplementation(() => {});

afterEach(() => {
  consoleWarnMock.mockClear();
});

describe("filterVisibleBlocks", () => {
  it("should filter out closed blocks", () => {
    const closedBlockStateIds = ["closed-block-1", "closed-block-2"];
    const blocks: Block[] = [
      getBlock({ blockStateId: "closed-block-1" }),
      getBlock({ blockStateId: "open-block" }),
    ];

    const visibleBlocks = filterVisibleBlocks(blocks, {
      closedBlockStateIds,
      legacyBranding: false,
      hostname: "example.com",
    });
    expect(visibleBlocks).toHaveLength(1);
    expect(visibleBlocks[0]?.blockStateId).toBe("open-block");
  });
  it("should return all blocks if no closed blocks are specified", () => {
    const blocks: Block[] = [
      getBlock({ blockStateId: "block-1" }),
      getBlock({ blockStateId: undefined }),
    ];

    const visibleBlocks = filterVisibleBlocks(blocks, {
      closedBlockStateIds: [],
      legacyBranding: false,
      hostname: "example.com",
    });
    expect(visibleBlocks).toHaveLength(2);
  });

  it("should keep all components when legacyBranding is false or hostname is localhost", () => {
    const blocks: Block[] = [
      getBlock({ blockStateId: "block-1", componentLibraryName: "library-1" }),
      getBlock({ blockStateId: "block-2" }),
      getBlock({
        blockStateId: undefined,
        tourBlocks: [
          getTourStep({ componentLibraryName: "library-2", type: "tour-component" }),
          getTourStep({ type: "tour-component" }),
          getTourStep({ type: "wait" }),
        ],
      }),
    ];

    const visibleBlocks = filterVisibleBlocks(blocks, {
      closedBlockStateIds: [],
      legacyBranding: false,
      hostname: "example.com",
    });
    expect(visibleBlocks).toHaveLength(3);
    expect(visibleBlocks[2]?.tourBlocks).toHaveLength(3);
    expect(consoleWarnMock).not.toHaveBeenCalled();

    const localhostVisibleBlocks = filterVisibleBlocks(blocks, {
      closedBlockStateIds: [],
      legacyBranding: true,
      hostname: "localhost",
    });
    expect(consoleWarnMock).not.toHaveBeenCalled();
    expect(localhostVisibleBlocks).toHaveLength(3);
    expect(localhostVisibleBlocks[2]?.tourBlocks).toHaveLength(3);
  });
  it("should filter out custom components when legacyBranding is true", () => {
    const blocks: Block[] = [
      getBlock({ blockStateId: "block-1", componentLibraryName: "library-1" }),
      getBlock({ blockStateId: "block-2" }),
      getBlock({
        blockStateId: undefined,
        tourBlocks: [
          getTourStep({ componentLibraryName: "library-2", type: "tour-component" }),
          getTourStep({ type: "tour-component" }),
          getTourStep({ type: "wait" }),
        ],
      }),
    ];
    const visibleBlocks = filterVisibleBlocks(blocks, {
      closedBlockStateIds: [],
      legacyBranding: true,
      hostname: "example.com",
    });
    expect(consoleWarnMock).toHaveBeenCalledWith(
      expect.stringContaining("Blocked 2 custom components"),
      expect.anything(),
      expect.anything(),
    );
    expect(visibleBlocks).toHaveLength(2);
    expect(visibleBlocks[0]?.blockStateId).toBe("block-1");
    expect(visibleBlocks[1]?.tourBlocks).toHaveLength(2);
    expect(visibleBlocks[1]?.tourBlocks?.[0]?.componentLibraryName).toBe("library-2");
    expect(visibleBlocks[1]?.tourBlocks?.[1]?.type).toBe("wait");
  });
  it("should filter closed blocks and custom components at the same time", () => {
    const blocks: Block[] = [
      getBlock({ blockStateId: "block-1", componentLibraryName: "library-1" }),
      getBlock({ blockStateId: "block-2" }),
      getBlock({ blockStateId: "block-3" }),
      getBlock({
        blockStateId: "tour-block",
        tourBlocks: [getTourStep({ type: "tour-component" })],
      }),
    ];

    const visibleBlocks = filterVisibleBlocks(blocks, {
      closedBlockStateIds: ["block-2"],
      legacyBranding: true,
      hostname: "example.com",
    });
    expect(consoleWarnMock).toHaveBeenCalledWith(
      expect.stringContaining("Blocked 3 custom component"),
      expect.anything(),
      expect.anything(),
    );
    expect(visibleBlocks).toHaveLength(2);
    expect(visibleBlocks[0]?.blockStateId).toBe("block-1");
    expect(visibleBlocks[1]?.blockStateId).toBe("tour-block");
  });
});


describe("SuperBoard SDK transport authentication", () => {
  it("merges the rotatable SDK key without discarding caller headers", async () => {
    const { FLOW_SDK_KEY_HEADER, withSdkKey } = await import("../api");
    let captured = new Headers();
    const target = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      captured = new Headers(init?.headers);
      return {} as Response;
    }) as typeof fetch;
    const authenticated = withSdkKey(target, "environment-secret");

    await authenticated?.("https://example.test/v2/sdk/blocks", {
      headers: { "x-customer-header": "preserved" },
    });

    expect(captured.get(FLOW_SDK_KEY_HEADER)).toBe("environment-secret");
    expect(captured.get("x-customer-header")).toBe("preserved");
  });
});


describe("SuperBoard SDK event idempotency", () => {
  const response = (body: string, status: number): Response =>
    ({
      ok: status >= 200 && status < 300,
      status,
      statusText: status >= 200 && status < 300 ? "OK" : "Unavailable",
      text: async () => body,
    }) as Response;

  it("reuses the durable queue item id across a failed request and its retry", async () => {
    const { enqueueEvent, sendEvents } = await import("../event-queue");
    const attempts: string[] = [];
    let requestNumber = 0;
    const target = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestNumber += 1;
      attempts.push(new Headers(init?.headers).get("Idempotency-Key") ?? "");
      return response(
        requestNumber === 1 ? "{\"message\":\"retry\"}" : "{}",
        requestNumber === 1 ? 503 : 200,
      );
    }) as typeof fetch;
    const event = {
      userId: "user-1",
      environment: "test",
      projectId: "project-1",
      name: "workflow-start" as const,
      workflowId: "workflow-1",
    };

    await enqueueEvent({
      event,
      apiContext: { apiUrl: "/api/v1/flows", version: "test" },
      customFetch: target,
    });
    await sendEvents(target);

    expect(attempts).toHaveLength(2);
    expect(attempts[0]).not.toBe("");
    expect(attempts[1]).toBe(attempts[0]);
  });

  it("keeps command order by stopping at the first failed event", async () => {
    const { enqueueEvent, sendEvents } = await import("../event-queue");
    localStorage.removeItem("flows-events-queue");
    const attempts: string[] = [];
    let available = false;
    const target = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { workflowId?: string };
      attempts.push(body.workflowId ?? "");
      return response(available ? "{}" : "{\"message\":\"retry\"}", available ? 200 : 503);
    }) as typeof fetch;
    const context = { apiUrl: "/api/v1/flows", version: "test" };

    await enqueueEvent({
      event: {
        userId: "user-1",
        environment: "test",
        projectId: "project-1",
        name: "workflow-start",
        workflowId: "workflow-a",
      },
      apiContext: context,
      customFetch: target,
    });
    await enqueueEvent({
      event: {
        userId: "user-1",
        environment: "test",
        projectId: "project-1",
        name: "workflow-start",
        workflowId: "workflow-b",
      },
      apiContext: context,
      customFetch: target,
    });

    expect(attempts).toEqual(["workflow-a", "workflow-a"]);
    available = true;
    await sendEvents(target);
    expect(attempts).toEqual(["workflow-a", "workflow-a", "workflow-a", "workflow-b"]);
  });

  it("uses the survey block state as the stable submission key", async () => {
    const { getApi } = await import("../api");
    const keys: string[] = [];
    const target = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      keys.push(new Headers(init?.headers).get("Idempotency-Key") ?? "");
      return response("{}", 200);
    }) as typeof fetch;
    const answer = {
      userId: "user-1",
      environment: "test",
      projectId: "project-1",
      surveyId: "survey-1",
      blockStateId: "survey-state-1",
      questions: [],
      url: "https://example.test",
    };

    await getApi({ apiUrl: "/api/v1/flows", version: "test", customFetch: target })
      .postSurvey(answer, answer.blockStateId);
    await getApi({ apiUrl: "/api/v1/flows", version: "test", customFetch: target })
      .postSurvey(answer, answer.blockStateId);

    expect(keys).toEqual(["survey-state-1", "survey-state-1"]);
  });

  it("deduplicates activations by runtime block state instead of block definition", async () => {
    const { createActiveBlockProxy } = await import("../types/active-block");
    const activations: string[] = [];
    const makeBlock = (blockStateId: string) => ({
      id: "shared-definition",
      blockStateId,
      workflowId: "workflow-1",
      type: "component" as const,
      component: "Card",
      props: {
        __flows: {
          id: "shared-definition",
          workflowId: "workflow-1",
          legacyBranding: false,
        },
      },
    });
    const activate = async (_blockId: string, blockStateId?: string) => {
      activations.push(blockStateId ?? "");
    };

    void createActiveBlockProxy(makeBlock("state-1"), activate).props;
    void createActiveBlockProxy(makeBlock("state-2"), activate).props;

    expect(activations).toEqual(["state-1", "state-2"]);
  });
});
