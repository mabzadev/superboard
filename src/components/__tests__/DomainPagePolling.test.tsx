/**
 * Regression test for the stale "Pending" bubble: the real DomainPage
 * (subdomain field + CustomDomainSetup + MigrationEntry) with real query
 * hooks and a real QueryClient. Only the API service layer and app chrome
 * are mocked.
 *
 * Scenario: domain pending, popup opened and closed, backend flips to
 * active — the card bubble must update via the list poll, without a reload.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/api/configurations/domains/configDomainsService", () => ({
  getProjectDomainAPICall: vi.fn(),
  getDomainDefaultsAPICall: vi.fn(),
  getCustomDomainAPICall: vi.fn(),
  getCustomDomainsAPICall: vi.fn(),
  getCustomDomainPreflightAPICall: vi.fn(),
  setSubdomainAPICall: vi.fn(),
  verifySubdomainAvailabilityAPICall: vi.fn(),
  setGoogleTrackingIDAPICall: vi.fn(),
  addCustomDomainWithPurposeAPICall: vi.fn(),
  removeCustomDomainByPurposeAPICall: vi.fn(),
}));
vi.mock("@/api/configurations/redirect/configRedirectService", () => ({
  getProjectRedirectsAPICall: vi.fn(),
  setDefaultRedirectAPICall: vi.fn(),
  setRedirectAPICall: vi.fn(),
}));
vi.mock("@/api/migrations/migrationsService", () => ({
  getMigrationSourceAPICall: vi.fn(),
  createMigrationAPICall: vi.fn(),
  deleteMigrationSourceAPICall: vi.fn(),
  testMigrationSourceAPICall: vi.fn(),
}));

vi.mock("@/components/layout/app-header", () => ({
  default: () => <div data-testid="app-header" />,
}));
vi.mock("@/hooks/queries/usePaymentsQueries", () => ({
  useSubscriptionQuery: vi.fn(() => ({
    data: { subscription: { type: "pro" } },
    isLoading: false,
  })),
}));
vi.mock("@/hooks/queries/useInstanceQueries", () => ({
  useInstanceDetailsQuery: vi.fn(() => ({
    data: { get_started_setup: { ios_sdk: false, android_sdk: false } },
  })),
}));
vi.mock("@/context/useProjectSelection", () => ({
  useProjectSelection: vi.fn(() => ({
    selectedProject: { id: "p1" },
    selectedInstance: { id: "inst-1" },
  })),
}));
vi.mock("@/hooks/mutations/usePaymentsMutations", () => ({
  useCreateSubscriptionMutation: vi.fn(() => ({ mutateAsync: vi.fn() })),
}));
vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({ push: vi.fn() })),
}));
vi.mock("@/analytics", () => ({
  trackEvent: vi.fn(),
  EVENTS: new Proxy({}, { get: () => "event" }),
}));
vi.mock("@/lib/config", () => ({
  config: {
    pricingUrl: "https://example.com/pricing",
    supportEmail: "support@example.com",
    apiPath: "/api/v1",
    apiUrl: "http://test",
  },
}));

import {
  getProjectDomainAPICall,
  getCustomDomainAPICall,
  getCustomDomainsAPICall,
  getCustomDomainPreflightAPICall,
} from "@/api/configurations/domains/configDomainsService";
import { getMigrationSourceAPICall } from "@/api/migrations/migrationsService";
import DomainPage from "@/app/(protected)/link_behaviour/domain/page";

const mockedDomainConfig = vi.mocked(getProjectDomainAPICall);
const mockedSingular = vi.mocked(getCustomDomainAPICall);
const mockedList = vi.mocked(getCustomDomainsAPICall);
const mockedPreflight = vi.mocked(getCustomDomainPreflightAPICall);
const mockedSource = vi.mocked(getMigrationSourceAPICall);

const pendingPrimary = {
  hostname: "links.acme.com",
  purpose: "primary",
  status: "pending",
  ssl_status: "pending_validation",
  ssl_validation_txt_records: [
    { name: "_acme-challenge.links.acme.com", value: "tok" },
  ],
  ownership_verification_txt_name: "_cf-custom-hostname.links.acme.com",
  ownership_verification_txt_value: "uuid",
  verification_errors: null,
  source: "saas",
  cname_target: "x.cdn.example",
};
const activePrimary = {
  ...pendingPrimary,
  status: "active",
  ssl_status: "active",
  ssl_validation_txt_records: [],
  ownership_verification_txt_name: null,
  ownership_verification_txt_value: null,
};

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  });
}

describe("page-level repro: stale pending bubble", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockedDomainConfig.mockResolvedValue({
      data: {
        domain: { subdomain: "acme", domain: "grovs.link" },
      },
    } as never);
    mockedSource.mockResolvedValue({
      data: { migration_source: null },
    } as never);
    mockedPreflight.mockResolvedValue({
      data: {
        hostname: "links.acme.com",
        cname_expected: "x.cdn.example",
        cname_actual: null,
        cname_matches: false,
        checked_at: "2026-06-12T00:00:00Z",
      },
    } as never);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("bubble updates after open/close popup + backend flip, no reload", async () => {
    let backendStatus: "pending" | "active" = "pending";
    const row = () =>
      backendStatus === "pending" ? pendingPrimary : activePrimary;
    let listCalls = 0;
    mockedList.mockImplementation(async () => {
      listCalls += 1;
      return { data: { custom_domains: [row()] } } as never;
    });
    mockedSingular.mockImplementation(async () => {
      return { data: { custom_domain: row() } } as never;
    });

    const client = makeClient();
    render(
      <QueryClientProvider client={client}>
        <DomainPage />
      </QueryClientProvider>
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText("Pending")).toBeInTheDocument();

    // Open the custom domain popup, let preflight settle, close it via Escape.
    fireEvent.click(screen.getByRole("button", { name: /view setup/i }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText("Pending")).toBeInTheDocument();

    // Backend verifies while the user stays on the screen.
    backendStatus = "active";
    const callsBefore = listCalls;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });

    expect(listCalls).toBeGreaterThan(callsBefore);
    expect(screen.queryByText("Pending")).toBeNull();
  });
});
