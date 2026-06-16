import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError } from "@/lib/ApiError";
import type { CustomDomain, MigrationSource } from "@/types";

vi.mock("../MigrationWizard", () => ({
  __esModule: true,
  default: ({
    projectId,
    onIdleCancel,
  }: {
    projectId: string;
    onIdleCancel?: () => void;
  }) => (
    <div data-testid="migration-wizard-stub">
      <span>Which provider are you migrating from?</span>
      <span>wizard:{projectId}</span>
      <button type="button" onClick={onIdleCancel}>
        Cancel migration
      </button>
    </div>
  ),
}));

vi.mock("@/hooks/queries/useConfigurationQueries", () => ({
  useCustomDomainPreflightQuery: vi.fn(),
  useCustomDomainsQuery: vi.fn(),
}));

vi.mock("@/hooks/queries/useMigrationQueries", () => ({
  useMigrationSourceQuery: vi.fn(),
}));

vi.mock("@/hooks/queries/usePaymentsQueries", () => ({
  useSubscriptionQuery: vi.fn(),
}));

vi.mock("@/hooks/mutations/usePaymentsMutations", () => ({
  useCreateSubscriptionMutation: vi.fn(),
}));

vi.mock("@/context/useProjectSelection", () => ({
  useProjectSelection: vi.fn(),
}));

vi.mock("@/lib/Notifications", () => ({
  showErrorNotification: vi.fn(),
}));

vi.mock("@/lib/config", () => ({
  config: { supportEmail: "support@example.com" },
}));

vi.mock("@/components/settings/ScaleUpDialog", () => ({
  __esModule: true,
  default: ({ open }: { open: boolean }) =>
    open ? <div data-testid="scale-up-dialog">Scale Up</div> : null,
}));

import {
  useCustomDomainPreflightQuery,
  useCustomDomainsQuery,
} from "@/hooks/queries/useConfigurationQueries";
import { useMigrationSourceQuery } from "@/hooks/queries/useMigrationQueries";
import { useSubscriptionQuery } from "@/hooks/queries/usePaymentsQueries";
import { useCreateSubscriptionMutation } from "@/hooks/mutations/usePaymentsMutations";
import { useProjectSelection } from "@/context/useProjectSelection";
import MigrationEntry from "../MigrationEntry";

const mockedDomains = vi.mocked(useCustomDomainsQuery);
const mockedPreflight = vi.mocked(useCustomDomainPreflightQuery);
const mockedSource = vi.mocked(useMigrationSourceQuery);
const mockedSubscription = vi.mocked(useSubscriptionQuery);
const mockedCreateSubscription = vi.mocked(useCreateSubscriptionMutation);
const mockedProjectSelection = vi.mocked(useProjectSelection);

const PROJECT_ID = "p1";

// The component uses useQueryClient (popup-close reconciliation), so renders
// need a real provider even though the query hooks themselves are mocked.
const renderWithClient = (ui: React.ReactElement) =>
  render(
    <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>
  );

function makeDomain(overrides: Partial<CustomDomain> = {}): CustomDomain {
  return {
    hostname: "old.acme.com",
    purpose: "migration",
    status: "pending",
    cname_target: "proxy-fallback.sqd.link",
    ssl_status: null,
    verification_errors: null,
    source: "saas",
    ...overrides,
  };
}

function makeSource(overrides: Partial<MigrationSource> = {}): MigrationSource {
  return {
    id: 1,
    provider: "branch",
    old_host: "old.acme.com",
    enabled: true,
    health: "healthy",
    consecutive_failures: 0,
    first_failure_at: null,
    last_error_status: null,
    created_at: "2026-06-01T00:00:00Z",
    updated_at: "2026-06-01T00:00:00Z",
    ...overrides,
  };
}

function setDomains(data: CustomDomain[] = []) {
  mockedDomains.mockReturnValue({
    data,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  } as never);
}

function setSource(
  state: {
    data?: MigrationSource | null;
    isError?: boolean;
    error?: unknown;
  } = {}
) {
  mockedSource.mockReturnValue({
    data: state.data ?? null,
    isLoading: false,
    isError: state.isError ?? false,
    error: state.error ?? null,
    refetch: vi.fn(),
  } as never);
}

function setPreflight(cnameMatches: boolean | null = null) {
  mockedPreflight.mockReturnValue({
    data:
      cnameMatches === null
        ? null
        : {
            hostname: "old.acme.com",
            cname_matches: cnameMatches,
            cname_actual: null,
            dns_error: null,
          },
    isLoading: false,
    isFetching: false,
  } as never);
}

describe("MigrationEntry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setDomains();
    setSource();
    setPreflight();
    mockedProjectSelection.mockReturnValue({
      selectedInstance: { id: "inst-1" },
    } as never);
    mockedSubscription.mockReturnValue({
      data: { subscription: { type: "pro" } },
      isLoading: false,
    } as never);
    mockedCreateSubscription.mockReturnValue({
      mutateAsync: vi.fn(),
    } as never);
  });

  it("shows the compact migration launcher when no migration has started", () => {
    renderWithClient(<MigrationEntry projectId={PROJECT_ID} />);
    expect(
      screen.getByRole("button", { name: /migrate from another platform/i })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/old links are recreated on demand/i)
    ).toBeInTheDocument();
    expect(screen.queryByTestId("migration-wizard-stub")).toBeNull();
  });

  it("opens the wizard after the launcher is clicked", () => {
    renderWithClient(<MigrationEntry projectId={PROJECT_ID} />);
    fireEvent.click(
      screen.getByRole("button", { name: /migrate from another platform/i })
    );
    expect(screen.getByTestId("migration-wizard-stub")).toHaveTextContent(
      `wizard:${PROJECT_ID}`
    );
    expect(
      screen.getByText(/which provider are you migrating from\?/i)
    ).toBeInTheDocument();
  });

  it("shows a paid-plan upsell instead of the wizard without a subscription", () => {
    mockedSubscription.mockReturnValue({
      data: { subscription: null },
      isLoading: false,
    } as never);

    renderWithClient(<MigrationEntry projectId={PROJECT_ID} />);
    fireEvent.click(
      screen.getByRole("button", { name: /migrate from another platform/i })
    );

    expect(
      screen.getByText(/migration requires a paid plan/i)
    ).toBeInTheDocument();
    expect(screen.queryByTestId("migration-wizard-stub")).toBeNull();
  });

  it("opens the scale-up dialog from the upsell", () => {
    mockedSubscription.mockReturnValue({
      data: { subscription: null },
      isLoading: false,
    } as never);

    renderWithClient(<MigrationEntry projectId={PROJECT_ID} />);
    fireEvent.click(
      screen.getByRole("button", { name: /migrate from another platform/i })
    );
    fireEvent.click(screen.getByRole("button", { name: /view plans/i }));

    expect(screen.getByTestId("scale-up-dialog")).toBeInTheDocument();
  });

  it("refetches the domain + source queries when the popup closes", async () => {
    const { queryKeys } = await import("@/lib/queryKeys");
    setDomains([makeDomain()]);
    setSource({ data: makeSource() });
    const client = new QueryClient();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    render(
      <QueryClientProvider client={client}>
        <MigrationEntry projectId={PROJECT_ID} />
      </QueryClientProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: /view setup/i }));
    expect(invalidateSpy).not.toHaveBeenCalled();
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.projects.customDomains(PROJECT_ID),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.projects.migrationSource(PROJECT_ID),
    });
  });

  it("returns to the compact launcher when an idle wizard is cancelled", () => {
    renderWithClient(<MigrationEntry projectId={PROJECT_ID} />);
    fireEvent.click(
      screen.getByRole("button", { name: /migrate from another platform/i })
    );
    fireEvent.click(
      screen.getByRole("button", { name: /^cancel migration$/i })
    );
    expect(screen.queryByTestId("migration-wizard-stub")).toBeNull();
    expect(
      screen.getByRole("button", { name: /migrate from another platform/i })
    ).toBeInTheDocument();
  });

  it("resumes automatically when a migration domain exists", () => {
    setDomains([makeDomain()]);
    renderWithClient(<MigrationEntry projectId={PROJECT_ID} />);
    expect(screen.getByText("old.acme.com")).toBeInTheDocument();
    expect(screen.getByText(/waiting for ssl/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /view setup/i })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /migrate from another platform/i })
    ).toBeNull();
  });

  it("shows deploying SSL when the migration domain is deploying", () => {
    setDomains([
      makeDomain({
        status: "pending",
        ssl_status: "pending_deployment",
      }),
    ]);
    renderWithClient(<MigrationEntry projectId={PROJECT_ID} />);
    expect(screen.getByText(/deploying ssl/i)).toBeInTheDocument();
  });

  it("shows waiting for DNS when Cloudflare is active but CNAME is not flipped", () => {
    setDomains([
      makeDomain({
        status: "active",
        ssl_status: "active",
      }),
    ]);
    setSource({ data: makeSource() });
    setPreflight(false);
    renderWithClient(<MigrationEntry projectId={PROJECT_ID} />);
    expect(screen.getByText(/ready.*waiting for dns/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /view setup/i })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^manage$/i })
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /view setup/i }));
    expect(
      screen.getByRole("heading", { name: /migration setup/i })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /manage migration/i })
    ).not.toBeInTheDocument();
  });

  it("shows Active and Manage only after the CNAME preflight passes", () => {
    setDomains([
      makeDomain({
        status: "active",
        ssl_status: "active",
      }),
    ]);
    setSource({ data: makeSource() });
    setPreflight(true);
    renderWithClient(<MigrationEntry projectId={PROJECT_ID} />);
    expect(screen.getByText(/^active$/i)).toBeInTheDocument();
    expect(screen.queryByText(/waiting for dns/i)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^manage$/i })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /view setup/i })
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^manage$/i }));
    expect(
      screen.getByRole("heading", { name: /manage migration/i })
    ).toBeInTheDocument();
    expect(screen.getByText(/migration is active/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /migration setup/i })
    ).not.toBeInTheDocument();
  });

  it("resumes automatically when a migration source exists", () => {
    setSource({ data: makeSource() });
    renderWithClient(<MigrationEntry projectId={PROJECT_ID} />);
    fireEvent.click(screen.getByRole("button", { name: /view setup/i }));
    expect(screen.getByTestId("migration-wizard-stub")).toBeInTheDocument();
  });

  it("renders nothing when the migration feature is off", () => {
    setSource({ isError: true, error: new ApiError("unavailable", 503) });
    const { container } = renderWithClient(
      <MigrationEntry projectId={PROJECT_ID} />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
