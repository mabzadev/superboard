import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import CutoverStep from "../steps/CutoverStep";
import type { CustomDomain } from "@/types";

// handleCopyText writes to navigator.clipboard + fires a notification toast.
// Stub the side-effecting module so tests don't depend on jsdom clipboard.
vi.mock("@/lib/copyTextHelper", () => ({
  handleCopyText: vi.fn(),
}));

function makeDomain(overrides: Partial<CustomDomain> = {}): CustomDomain {
  return {
    hostname: "old.acme.com",
    purpose: "migration",
    status: "active",
    ssl_status: null,
    verification_errors: null,
    source: "saas",
    cname_target: "proxy-fallback.sqd.link",
    ...overrides,
  };
}

function setup(
  overrides: Partial<React.ComponentProps<typeof CutoverStep>> = {}
) {
  const onConfirmCutover = vi.fn();
  const props: React.ComponentProps<typeof CutoverStep> = {
    domain: makeDomain(),
    testPending: false,
    ...overrides,
  };
  const utils = render(<CutoverStep {...props} />);
  return { ...utils, onConfirmCutover };
}

describe("CutoverStep", () => {
  it("renders the hostname and cname_target", () => {
    setup();
    // Both values appear in body copy + DNS row.
    expect(screen.getAllByText("old.acme.com").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText("proxy-fallback.sqd.link").length
    ).toBeGreaterThan(0);
  });

  it("does not render manual test controls", () => {
    setup();
    expect(
      screen.queryByRole("button", { name: /test the cutover/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /test slug/i })
    ).not.toBeInTheDocument();
  });

  it("renders a preparing status until prerequisites pass", () => {
    setup();
    expect(screen.getByText(/preparing migration/i)).toBeInTheDocument();
  });

  it("renders cutover complete when preflight matches", () => {
    setup({
      preflight: {
        hostname: "old.acme.com",
        cname_matches: true,
        cname_actual: "proxy-fallback.sqd.link",
      },
    });
    expect(screen.getByText(/cutover complete/i)).toBeInTheDocument();
  });

  it("does not list credentials as pending when the last test outcome is ok", () => {
    setup({ lastTestOutcome: "credentials_ok" });
    expect(screen.getByText(/preparing migration/i)).toHaveTextContent(
      "source health"
    );
    expect(screen.getByText(/preparing migration/i)).not.toHaveTextContent(
      "credentials"
    );
  });

  it("shows automatic checking state while testPending", () => {
    setup({ testPending: true });
    expect(screen.getByText(/checking credentials/i)).toBeInTheDocument();
  });
});
