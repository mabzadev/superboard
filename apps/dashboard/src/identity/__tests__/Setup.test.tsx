import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import Setup from "../Setup";

const mocks = vi.hoisted(() => ({
  project: {
    selectedProject: { id: "project-one" },
    selectedInstance: { role: "owner" },
  } as {
    selectedProject?: { id: string };
    selectedInstance?: { role?: string };
  },
}));

vi.mock("@/context/useProjectSelection", () => ({
  useProjectSelection: () => mocks.project,
}));

vi.mock("@/lib/LocalStorage", () => ({
  default: {
    getAuthenticationToken: () => "dashboard-token",
  },
}));

vi.mock("@/lib/config", () => ({
  config: {
    apiUrl: "https://api.example.test",
    apiPath: "/api/v1",
    authUrl: "https://auth.example.test",
  },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Identity Setup", () => {
  beforeEach(() => {
    mocks.project = {
      selectedProject: { id: "project-one" },
      selectedInstance: { role: "owner" },
    };
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("does not mount Melody pages before project configuration is ready", async () => {
    const configuration = deferred<Response>();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(() => configuration.promise)
      .mockResolvedValueOnce(
        jsonResponse({
          apps: [
            {
              clientId: "client-one",
              isActive: true,
              redirectUris: ["https://app.example.test/callback"],
              type: "spa",
            },
          ],
        }),
      );

    render(
      <Setup>
        <div>Melody page content</div>
      </Setup>,
    );

    expect(screen.queryByText("Melody page content")).not.toBeInTheDocument();

    await act(async () => {
      configuration.resolve(jsonResponse({ configs: { ENABLE_ORG: true } }));
      await configuration.promise;
    });

    expect(await screen.findByText("Melody page content")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://api.example.test/api/v1/identity-admin/projects/project-one",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("keeps the previous project hidden and clears its primary app during a switch", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ configs: { ENABLE_ORG: true } }))
      .mockResolvedValueOnce(
        jsonResponse({
          apps: [
            {
              clientId: "client-one",
              isActive: true,
              redirectUris: ["https://one.example.test/callback"],
              type: "spa",
            },
          ],
        }),
      );

    const view = render(
      <Setup>
        <div>Melody page content</div>
      </Setup>,
    );

    expect(await screen.findByText("Melody page content")).toBeInTheDocument();
    expect(window.sessionStorage.getItem("superboard.identity.primaryApp")).toContain(
      "client-one",
    );

    const secondConfiguration = deferred<Response>();
    vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(() => secondConfiguration.promise)
      .mockResolvedValueOnce(jsonResponse({ apps: [] }));
    mocks.project = {
      selectedProject: { id: "project-two" },
      selectedInstance: { role: "owner" },
    };

    view.rerender(
      <Setup>
        <div>Melody page content</div>
      </Setup>,
    );

    expect(screen.queryByText("Melody page content")).not.toBeInTheDocument();
    expect(window.sessionStorage.getItem("superboard.identity.primaryApp")).toBeNull();

    await act(async () => {
      secondConfiguration.resolve(jsonResponse({ configs: { ENABLE_ORG: false } }));
      await secondConfiguration.promise;
    });

    expect(await screen.findByText("Melody page content")).toBeInTheDocument();
  });

  it("does not expose a partially initialized page when configuration fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse({ error: { message: "Identity unavailable" } }, 503),
    );

    render(
      <Setup>
        <div>Melody page content</div>
      </Setup>,
    );

    expect(await screen.findByText("Identity request failed")).toBeInTheDocument();
    expect(screen.queryByText("Melody page content")).not.toBeInTheDocument();
  });
});
