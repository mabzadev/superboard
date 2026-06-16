import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === "undefined") {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    (
      globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }
    ).ResizeObserver = ResizeObserverStub;
  }
});

import { ApiError } from "@/lib/ApiError";
import type { CustomDomain, MigrationSource } from "@/types";

vi.mock("@/hooks/queries/useConfigurationQueries", () => ({
  useCustomDomainPreflightQuery: vi.fn(),
  useCustomDomainsQuery: vi.fn(),
}));

vi.mock("@/hooks/queries/useMigrationQueries", () => ({
  useMigrationSourceQuery: vi.fn(),
}));

vi.mock("@/hooks/mutations/useConfigurationMutations", () => ({
  useRemoveCustomDomainMutation: vi.fn(),
}));

vi.mock("@/hooks/mutations/useMigrationMutations", () => ({
  useCreateMigrationMutation: vi.fn(),
  useDeleteMigrationSourceMutation: vi.fn(),
  useTestMigrationSourceMutation: vi.fn(),
}));

vi.mock("@/lib/Notifications", () => ({
  showErrorNotification: vi.fn(),
}));

vi.mock("@/lib/copyTextHelper", () => ({ handleCopyText: vi.fn() }));

import {
  useCustomDomainPreflightQuery,
  useCustomDomainsQuery,
} from "@/hooks/queries/useConfigurationQueries";
import { useMigrationSourceQuery } from "@/hooks/queries/useMigrationQueries";
import { useRemoveCustomDomainMutation } from "@/hooks/mutations/useConfigurationMutations";
import {
  useCreateMigrationMutation,
  useDeleteMigrationSourceMutation,
  useTestMigrationSourceMutation,
} from "@/hooks/mutations/useMigrationMutations";
import MigrationWizard from "../MigrationWizard";

const mockedDomains = vi.mocked(useCustomDomainsQuery);
const mockedPreflight = vi.mocked(useCustomDomainPreflightQuery);
const mockedSource = vi.mocked(useMigrationSourceQuery);
const mockedRemoveDomain = vi.mocked(useRemoveCustomDomainMutation);
const mockedCreateMigration = vi.mocked(useCreateMigrationMutation);
const mockedDeleteSource = vi.mocked(useDeleteMigrationSourceMutation);
const mockedTestSource = vi.mocked(useTestMigrationSourceMutation);

const PROJECT_ID = "p1";

function chooseProvider(name: RegExp) {
  fireEvent.click(
    screen.getByRole("button", { name: /select source platform/i })
  );
  fireEvent.click(screen.getByRole("button", { name }));
}

function buildDomain(overrides: Partial<CustomDomain> = {}): CustomDomain {
  return {
    hostname: "old.acme.com",
    purpose: "migration",
    status: "active",
    cname_target: "proxy-fallback.grovs.link",
    ssl_status: "active",
    verification_errors: null,
    source: "saas",
    ...overrides,
  };
}

function buildSource(
  overrides: Partial<MigrationSource> = {}
): MigrationSource {
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

interface DomainsState {
  data?: CustomDomain[];
  isLoading?: boolean;
}

interface SourceState {
  data?: MigrationSource | null;
  isLoading?: boolean;
  isError?: boolean;
  error?: unknown;
}

function setDomains(state: DomainsState = {}) {
  mockedDomains.mockReturnValue({
    data: state.data ?? [],
    isLoading: state.isLoading ?? false,
    refetch: vi.fn(),
  } as never);
}

function setSource(state: SourceState = {}) {
  mockedSource.mockReturnValue({
    data: state.data ?? null,
    isLoading: state.isLoading ?? false,
    isError: state.isError ?? false,
    error: state.error ?? null,
    refetch: vi.fn(),
  } as never);
}

function stubMutation(extra: Record<string, unknown> = {}) {
  return {
    mutateAsync: vi.fn(),
    isPending: false,
    ...extra,
  } as never;
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

describe("MigrationWizard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    setDomains();
    setSource();
    setPreflight();
    mockedRemoveDomain.mockReturnValue(stubMutation());
    mockedCreateMigration.mockReturnValue(stubMutation());
    mockedDeleteSource.mockReturnValue(stubMutation());
    mockedTestSource.mockReturnValue(stubMutation());
  });

  it("renders the not_admin alert on 403 source error", () => {
    setSource({ isError: true, error: new ApiError("forbidden", 403) });
    render(<MigrationWizard projectId={PROJECT_ID} />);
    expect(
      screen.getByText(/only project admins can configure migration/i)
    ).toBeInTheDocument();
  });

  it("renders nothing when feature is off", () => {
    setSource({ isError: true, error: new ApiError("unavailable", 503) });
    const { container } = render(<MigrationWizard projectId={PROJECT_ID} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("submits the combined migration create request", async () => {
    const createMutate = vi.fn().mockResolvedValue({ data: {} });
    mockedCreateMigration.mockReturnValue(
      stubMutation({ mutateAsync: createMutate })
    );

    render(<MigrationWizard projectId={PROJECT_ID} />);

    chooseProvider(/branch/i);
    fireEvent.change(screen.getByLabelText("Branch key"), {
      target: { value: "key_live_abc" },
    });
    fireEvent.change(screen.getByLabelText(/branch subdomain/i), {
      target: { value: "old.acme.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /start migration/i }));

    await waitFor(() => {
      expect(createMutate).toHaveBeenCalledWith({
        provider: "branch",
        hostname: "old.acme.com",
        credentials: { branch_key: "key_live_abc" },
      });
    });
  });

  it("renders setup steps while the migration domain is pending", () => {
    setDomains({
      data: [
        buildDomain({
          status: "pending",
          ssl_status: "active",
          ownership_verification_txt_name: "_cf-custom-hostname.old.acme.com",
          ownership_verification_txt_value: "owner-token",
        }),
      ],
    });
    setSource({ data: buildSource() });

    render(<MigrationWizard projectId={PROJECT_ID} />);

    expect(screen.getByText("Checking setup")).toBeInTheDocument();
    expect(screen.getByText("Hostname ownership verified")).toBeInTheDocument();
    expect(screen.getByText("CNAME pointing to Grovs")).toBeInTheDocument();
  });

  it("does not render management before the migration domain is active", () => {
    setDomains({
      data: [
        buildDomain({
          status: "pending",
          ssl_status: "active",
          ownership_verification_txt_name: "_cf-custom-hostname.old.acme.com",
          ownership_verification_txt_value: "owner-token",
        }),
      ],
    });
    setSource({
      data: buildSource({
        health: "degraded",
        last_error_status: 400,
      }),
    });
    localStorage.setItem(`migration:${PROJECT_ID}:cutover_done`, "true");

    render(<MigrationWizard projectId={PROJECT_ID} />);

    expect(screen.getByText("Checking setup")).toBeInTheDocument();
    expect(screen.queryByText("Degraded")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^remove migration$/i })
    ).not.toBeInTheDocument();
  });

  it("keeps setup visible when the migration domain is active but CNAME is not flipped", () => {
    setDomains({ data: [buildDomain({ status: "active" })] });
    setSource({ data: buildSource() });
    setPreflight(false);

    render(<MigrationWizard projectId={PROJECT_ID} />);

    expect(screen.getByText("Checking setup")).toBeInTheDocument();
    expect(screen.getByText("CNAME pointing to Grovs")).toBeInTheDocument();
    expect(
      screen.getByText("Add this record at your DNS provider")
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^remove migration$/i })
    ).not.toBeInTheDocument();
  });

  it("renders management only when the migration domain is active and CNAME matches", () => {
    setDomains({ data: [buildDomain({ status: "active" })] });
    setSource({ data: buildSource() });
    setPreflight(true);

    render(<MigrationWizard projectId={PROJECT_ID} />);

    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^remove migration$/i })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /rotate credentials/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^test$/i })
    ).not.toBeInTheDocument();
  });

  it("remove migration tears down source and migration domain", async () => {
    setDomains({ data: [buildDomain({ status: "active" })] });
    setSource({ data: buildSource() });
    setPreflight(true);
    const deleteSourceMutate = vi.fn().mockResolvedValue({ data: {} });
    const removeDomainMutate = vi.fn().mockResolvedValue({ data: {} });
    mockedDeleteSource.mockReturnValue(
      stubMutation({ mutateAsync: deleteSourceMutate })
    );
    mockedRemoveDomain.mockReturnValue(
      stubMutation({ mutateAsync: removeDomainMutate })
    );
    const onMigrationCancelled = vi.fn();

    render(
      <MigrationWizard
        projectId={PROJECT_ID}
        onMigrationCancelled={onMigrationCancelled}
      />
    );

    fireEvent.click(
      screen.getByRole("button", { name: /^remove migration$/i })
    );

    const confirmInput = await screen.findByLabelText(/type.*to confirm/i);
    fireEvent.change(confirmInput, { target: { value: "old.acme.com" } });

    const removeButtons = screen.getAllByRole("button", {
      name: /^remove migration$/i,
    });
    const dialogAction = removeButtons[removeButtons.length - 1];
    if (!dialogAction) throw new Error("remove action missing");
    fireEvent.click(dialogAction);

    await waitFor(() => {
      expect(deleteSourceMutate).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(removeDomainMutate).toHaveBeenCalledWith("migration");
    });
    expect(onMigrationCancelled).toHaveBeenCalledTimes(1);
  });
});
