import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

// --- Mocks must be declared before importing the component under test ---

const replaceMock = vi.fn();
const useRouterMock = vi.fn();
const useSearchParamsMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => useRouterMock(),
  useSearchParams: () => useSearchParamsMock(),
}));

import MigrationDeepLinkRedirect from "@/app/(protected)/settings/MigrationDeepLinkRedirect";

function setUrl(search: string, hash: string) {
  const params = new URLSearchParams(search);
  useSearchParamsMock.mockReturnValue(params);
  // jsdom lets us mutate the hash directly on window.location.
  window.location.hash = hash;
}

beforeEach(() => {
  replaceMock.mockReset();
  useRouterMock.mockReset();
  useSearchParamsMock.mockReset();
  useRouterMock.mockReturnValue({ replace: replaceMock });
  // Default: clean URL state.
  window.location.hash = "";
});

describe("MigrationDeepLinkRedirect", () => {
  it("redirects to /link_behaviour/domain#migration when ?tab=migration is present", () => {
    setUrl("tab=migration", "");

    render(<MigrationDeepLinkRedirect />);

    expect(replaceMock).toHaveBeenCalledTimes(1);
    const target = replaceMock.mock.calls[0]?.[0] as string;
    expect(target).toContain("/link_behaviour/domain");
    expect(target).toContain("#migration");
    // The tab param must NOT be preserved (otherwise the effect would loop).
    expect(target).not.toContain("tab=migration");
  });

  it("redirects when the URL fragment contains 'migration'", () => {
    setUrl("", "#migration");

    render(<MigrationDeepLinkRedirect />);

    expect(replaceMock).toHaveBeenCalledTimes(1);
    const target = replaceMock.mock.calls[0]?.[0] as string;
    expect(target).toContain("/link_behaviour/domain");
    expect(target).toContain("#migration");
  });

  it("does not redirect for unrelated tabs or empty URL", () => {
    setUrl("tab=plan", "");

    render(<MigrationDeepLinkRedirect />);

    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("does not redirect when there is no tab param and no hash", () => {
    setUrl("", "");

    render(<MigrationDeepLinkRedirect />);

    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("preserves instance_id and env_type in the redirected URL", () => {
    setUrl(
      "tab=migration&instance_id=inst-123&env_type=production&other=ignored",
      ""
    );

    render(<MigrationDeepLinkRedirect />);

    expect(replaceMock).toHaveBeenCalledTimes(1);
    const target = replaceMock.mock.calls[0]?.[0] as string;
    expect(target).toContain("/link_behaviour/domain");
    expect(target).toContain("instance_id=inst-123");
    expect(target).toContain("env_type=production");
    expect(target).toContain("#migration");
    // Unrelated params should NOT be carried over.
    expect(target).not.toContain("other=ignored");
    expect(target).not.toContain("tab=migration");
  });
});
