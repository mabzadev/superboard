import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import DnsVerifyStep from "../steps/DnsVerifyStep";
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
    status: "pending",
    ssl_status: null,
    verification_errors: null,
    source: "saas",
    cname_target: "proxy-fallback.sqd.link",
    txt_record_name: "_acme-challenge.old.acme.com",
    txt_record_value: "abc-def-token-xyz",
    ...overrides,
  };
}

function setup(
  overrides: Partial<React.ComponentProps<typeof DnsVerifyStep>> = {}
) {
  const onRecheck = vi.fn();
  const props = {
    domain: makeDomain(),
    onRecheck,
    recheckPending: false,
    ...overrides,
  };
  const utils = render(<DnsVerifyStep {...props} />);
  return { ...utils, onRecheck };
}

describe("DnsVerifyStep", () => {
  it("renders the TXT challenge name and value", () => {
    setup();
    expect(
      screen.getByText("_acme-challenge.old.acme.com")
    ).toBeInTheDocument();
    expect(screen.getByText("abc-def-token-xyz")).toBeInTheDocument();
  });

  it("renders Cloudflare SSL validation TXT fields from the API response", () => {
    setup({
      domain: makeDomain({
        txt_record_name: null,
        txt_record_value: null,
        ssl_validation_txt_name: "_acme-challenge.branch.tabkeep.uk",
        ssl_validation_txt_value: "iRtGVkcapWfIEHyn_6zCu8EyJm0uwWdQq9dAzwH9jHw",
      }),
    });
    expect(
      screen.getByText("_acme-challenge.branch.tabkeep.uk")
    ).toBeInTheDocument();
    expect(
      screen.getByText("iRtGVkcapWfIEHyn_6zCu8EyJm0uwWdQq9dAzwH9jHw")
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/preparing ssl validation txt/i)
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/add the txt record below at your dns/i)
    ).toBeInTheDocument();
  });

  it("renders every Cloudflare SSL validation TXT record from the API response", () => {
    setup({
      domain: makeDomain({
        txt_record_name: null,
        txt_record_value: null,
        ssl_validation_txt_name: null,
        ssl_validation_txt_value: null,
        ssl_validation_txt_records: [
          {
            name: "_acme-challenge.branch.tabkeep.uk",
            value: "ABC-token",
          },
          {
            name: "_acme-challenge.branch.tabkeep.uk",
            value: "XYZ-token",
          },
        ],
      }),
    });

    expect(screen.getByText("SSL validation TXT 1")).toBeInTheDocument();
    expect(screen.getByText("SSL validation TXT 2")).toBeInTheDocument();
    expect(
      screen.getAllByText("_acme-challenge.branch.tabkeep.uk")
    ).toHaveLength(2);
    expect(screen.getByText("ABC-token")).toBeInTheDocument();
    expect(screen.getByText("XYZ-token")).toBeInTheDocument();
    expect(
      screen.queryByText(/preparing ssl validation txt/i)
    ).not.toBeInTheDocument();
  });

  it("renders hostname ownership TXT when Cloudflare pre-validation is required", () => {
    setup({
      domain: makeDomain({
        ssl_status: "active",
        status: "pending",
        txt_record_name: null,
        txt_record_value: null,
        ssl_validation_txt_name: null,
        ssl_validation_txt_value: null,
        ownership_verification_txt_name:
          "_cf-custom-hostname.branch.tabkeep.uk",
        ownership_verification_txt_value:
          "a890192a-e150-4ee0-8f3a-4e14035ceb8b",
      }),
    });
    expect(screen.getByText("Hostname ownership verified")).toBeInTheDocument();
    expect(
      screen.getByText("Add this TXT record at your DNS")
    ).toBeInTheDocument();
    expect(
      screen.getByText("_cf-custom-hostname.branch.tabkeep.uk")
    ).toBeInTheDocument();
    expect(
      screen.getByText("a890192a-e150-4ee0-8f3a-4e14035ceb8b")
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/preparing ssl validation txt/i)
    ).not.toBeInTheDocument();
    expect(screen.getByText("CNAME pointing to Grovs")).toBeInTheDocument();
    // SSL is issued, so the CNAME instructions must show even while the
    // ownership TXT is outstanding: on zones already hosted on Cloudflare the
    // pre-validation TXT can never activate the hostname — only the CNAME
    // can. Withholding it here would deadlock the setup.
    expect(
      screen.getByText("Add this record at your DNS provider")
    ).toBeInTheDocument();
    expect(
      screen.getByText(/ownership completes once the cname below is in place/i)
    ).toBeInTheDocument();
  });

  it("pending status renders the setup checklist", () => {
    setup({ domain: makeDomain({ status: "pending" }) });
    expect(screen.getByText("Checking setup")).toBeInTheDocument();
    expect(screen.getByText("Hostname ownership verified")).toBeInTheDocument();
    expect(screen.getByText("SSL certificate issued")).toBeInTheDocument();
    expect(screen.getByText("CNAME pointing to Grovs")).toBeInTheDocument();
    expect(
      screen
        .getByText("Hostname ownership verified")
        .compareDocumentPosition(screen.getByText("SSL certificate issued")) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      screen
        .getByText("SSL certificate issued")
        .compareDocumentPosition(screen.getByText("CNAME pointing to Grovs")) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      screen.queryByText("Add this record at your DNS provider")
    ).not.toBeInTheDocument();
  });

  it("renders the CNAME step only after SSL and ownership are complete", () => {
    setup({
      domain: makeDomain({
        status: "pending",
        ssl_status: "active",
        txt_record_name: null,
        txt_record_value: null,
        ssl_validation_txt_name: null,
        ssl_validation_txt_value: null,
        ownership_verification_txt_name: null,
        ownership_verification_txt_value: null,
      }),
    });
    expect(screen.getByText("CNAME pointing to Grovs")).toBeInTheDocument();
    expect(
      screen.getByText("Add this record at your DNS provider")
    ).toBeInTheDocument();
    expect(screen.getByText("proxy-fallback.sqd.link")).toBeInTheDocument();
  });

  it("keeps CNAME instructions hidden while SSL is pending even when ownership is verified", () => {
    setup({
      domain: makeDomain({
        hostname: "branch.tabkeep.uk",
        status: "pending",
        ssl_status: "pending_validation",
        txt_record_name: null,
        txt_record_value: null,
        ssl_validation_txt_name: "_acme-challenge.branch.tabkeep.uk",
        ssl_validation_txt_value: "0of10BXYTPpRbFDB75NzdGk-NEgyBknvB3S0O4k8Qms",
        ownership_verification_txt_name: null,
        ownership_verification_txt_value: null,
      }),
    });

    expect(screen.getByText("SSL certificate issued")).toBeInTheDocument();
    expect(
      screen.getByText("_acme-challenge.branch.tabkeep.uk")
    ).toBeInTheDocument();
    expect(
      screen.getByText("0of10BXYTPpRbFDB75NzdGk-NEgyBknvB3S0O4k8Qms")
    ).toBeInTheDocument();
    expect(screen.getByText("Hostname ownership verified")).toBeInTheDocument();
    expect(screen.getByText("CNAME pointing to Grovs")).toBeInTheDocument();
    expect(
      screen.queryByText("Add this record at your DNS provider")
    ).not.toBeInTheDocument();
    expect(screen.queryByText("branch.tabkeep.uk")).not.toBeInTheDocument();
  });

  it("waits for the SSL TXT challenge before rendering the SSL record", () => {
    setup({
      domain: makeDomain({
        txt_record_name: null,
        txt_record_value: null,
      }),
    });
    expect(
      screen.getByText(/preparing ssl validation txt/i)
    ).toBeInTheDocument();
    expect(screen.queryByText("TXT")).not.toBeInTheDocument();
    expect(
      screen.queryByText("_acme-challenge.old.acme.com")
    ).not.toBeInTheDocument();
  });

  it("failed status renders verification error and a Recheck button", () => {
    setup({
      domain: makeDomain({
        status: "failed",
        verification_errors: "CNAME not pointing at expected target",
      }),
    });
    expect(
      screen.getByText(/cname not pointing at expected target/i)
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /recheck/i })
    ).toBeInTheDocument();
    expect(screen.getByText("Setup failed")).toBeInTheDocument();
    expect(screen.queryByText("Checking setup")).not.toBeInTheDocument();
    expect(
      screen.queryByText(/waiting for setup to complete/i)
    ).not.toBeInTheDocument();
  });

  it("renders each entry when verification_errors is a string[]", () => {
    setup({
      domain: makeDomain({
        status: "failed",
        verification_errors: ["error A", "error B"],
      }),
    });
    expect(screen.getByText("error A")).toBeInTheDocument();
    expect(screen.getByText("error B")).toBeInTheDocument();
  });

  it("renders key:value entries when verification_errors is a record", () => {
    setup({
      domain: makeDomain({
        status: "failed",
        verification_errors: {
          dns: "CNAME mismatch",
          ssl: "no validation",
        },
      }),
    });
    expect(screen.getByText("dns: CNAME mismatch")).toBeInTheDocument();
    expect(screen.getByText("ssl: no validation")).toBeInTheDocument();
  });

  it("clicking Recheck invokes onRecheck", () => {
    const { onRecheck } = setup({
      domain: makeDomain({ status: "failed" }),
    });
    fireEvent.click(screen.getByRole("button", { name: /recheck/i }));
    expect(onRecheck).toHaveBeenCalledTimes(1);
  });

  it("retryAfterSeconds disables Recheck and renders the countdown copy", () => {
    setup({
      domain: makeDomain({ status: "failed" }),
      retryAfterSeconds: 45,
    });
    const button = screen.getByRole("button", { name: /try again in 45s/i });
    expect(button).toBeDisabled();
  });
});
