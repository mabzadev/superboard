import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/lib/config", () => ({
  config: {
    docsUrl: "https://docs.example.com",
  },
}));

vi.mock("@/hooks/queries/useMcpQueries", () => ({
  useMcpTokensQuery: vi.fn(),
  useRevokeMcpTokenMutation: vi.fn(),
}));

vi.mock("@/lib/Notifications", () => ({
  showSuccessNotification: vi.fn(),
  showErrorNotification: vi.fn(),
}));

import {
  useMcpTokensQuery,
  useRevokeMcpTokenMutation,
} from "@/hooks/queries/useMcpQueries";
import {
  showSuccessNotification,
  showErrorNotification,
} from "@/lib/Notifications";
import McpTokensSection from "../account/McpTokensSection";

const mockedUseMcpTokensQuery = vi.mocked(useMcpTokensQuery);
const mockedUseRevokeMutation = vi.mocked(useRevokeMcpTokenMutation);
const mockedShowSuccess = vi.mocked(showSuccessNotification);
const mockedShowError = vi.mocked(showErrorNotification);

const TOKEN_FIXTURES = [
  {
    id: "aBx9kZ",
    name: "Claude Desktop",
    created_at: "2026-04-01T12:00:00Z",
    last_used_at: "2026-04-07T15:30:00Z",
  },
  {
    id: "cDy3mW",
    name: "Cursor",
    created_at: "2026-04-05T10:00:00Z",
    last_used_at: null,
  },
];

describe("McpTokensSection", () => {
  let mutateAsyncMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mutateAsyncMock = vi.fn().mockResolvedValue({});
    mockedUseRevokeMutation.mockReturnValue({
      mutateAsync: mutateAsyncMock,
    } as never);
  });

  it("shows loading skeleton while fetching", () => {
    mockedUseMcpTokensQuery.mockReturnValue({
      data: undefined,
      isLoading: true,
    } as never);

    render(<McpTokensSection />);
    expect(screen.getByText("Connected Apps")).toBeInTheDocument();
    expect(document.querySelector(".animate-pulse")).toBeInTheDocument();
  });

  it("shows empty state with icon box, description, and docs link", () => {
    mockedUseMcpTokensQuery.mockReturnValue({
      data: [],
      isLoading: false,
    } as never);

    render(<McpTokensSection />);
    expect(screen.getByText("No connected apps")).toBeInTheDocument();
    expect(screen.getByText(/Connect AI tools/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /View setup guide/ });
    expect(link).toHaveAttribute("href", expect.stringContaining("/mcp"));
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("renders token list with name, status badge, dates, and revoke button", () => {
    mockedUseMcpTokensQuery.mockReturnValue({
      data: TOKEN_FIXTURES,
      isLoading: false,
    } as never);

    render(<McpTokensSection />);

    expect(screen.getByText("Claude Desktop")).toBeInTheDocument();
    expect(screen.getByText("Cursor")).toBeInTheDocument();
    // Connected status badges
    expect(screen.getAllByText("Connected")).toHaveLength(2);
    // Added dates
    expect(screen.getByText(/Apr 1, 2026/)).toBeInTheDocument();
    expect(screen.getByText(/Apr 5, 2026/)).toBeInTheDocument();
    // Revoke buttons
    expect(screen.getAllByRole("button", { name: /Revoke/ })).toHaveLength(2);
  });

  it("shows last active time only when last_used_at is present", () => {
    mockedUseMcpTokensQuery.mockReturnValue({
      data: TOKEN_FIXTURES,
      isLoading: false,
    } as never);

    render(<McpTokensSection />);

    // Claude Desktop has last_used_at, Cursor does not
    expect(screen.getAllByText(/Active/)).toHaveLength(1);
  });

  it("revoke button opens confirmation and calls mutateAsync with string id", async () => {
    mockedUseMcpTokensQuery.mockReturnValue({
      data: [TOKEN_FIXTURES[0]],
      isLoading: false,
    } as never);

    render(<McpTokensSection />);

    fireEvent.click(screen.getByRole("button", { name: /Revoke/ }));

    await waitFor(() => {
      expect(screen.getByText("Revoke access?")).toBeInTheDocument();
    });

    const dialogButtons = screen.getAllByRole("button", { name: /Revoke/ });
    const dialogConfirmButton = dialogButtons.find(
      (btn) => btn.closest("[role='dialog']") !== null
    );
    fireEvent.click(dialogConfirmButton!);

    await waitFor(() => {
      expect(mutateAsyncMock).toHaveBeenCalledWith("aBx9kZ");
    });
    expect(mockedShowSuccess).toHaveBeenCalledWith("Token revoked");
  });

  it("shows error notification when revoke fails", async () => {
    mockedUseMcpTokensQuery.mockReturnValue({
      data: [TOKEN_FIXTURES[0]],
      isLoading: false,
    } as never);
    mutateAsyncMock.mockRejectedValueOnce(new Error("Network error"));

    render(<McpTokensSection />);

    fireEvent.click(screen.getByRole("button", { name: /Revoke/ }));

    await waitFor(() => {
      expect(screen.getByText("Revoke access?")).toBeInTheDocument();
    });

    const dialogButtons = screen.getAllByRole("button", { name: /Revoke/ });
    const dialogConfirmButton = dialogButtons.find(
      (btn) => btn.closest("[role='dialog']") !== null
    );
    fireEvent.click(dialogConfirmButton!);

    await waitFor(() => {
      expect(mockedShowError).toHaveBeenCalledWith("Failed to revoke token");
    });
  });

  it("handles undefined data gracefully (same as empty)", () => {
    mockedUseMcpTokensQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
    } as never);

    render(<McpTokensSection />);
    expect(screen.getByText("No connected apps")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /View setup guide/ })
    ).toBeInTheDocument();
  });
});
