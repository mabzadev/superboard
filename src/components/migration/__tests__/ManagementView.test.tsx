import { describe, it, expect, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import ManagementView from "../steps/ManagementView";
import type { CustomDomain, MigrationSource } from "@/types";

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

function buildDomain(overrides: Partial<CustomDomain> = {}): CustomDomain {
  return {
    hostname: "old.acme.com",
    purpose: "migration",
    status: "active",
    cname_target: "proxy-fallback.sqd.link",
    ssl_status: null,
    verification_errors: null,
    source: "saas",
    ...overrides,
  };
}

type Props = React.ComponentProps<typeof ManagementView>;

function setup(overrides: Partial<Props> = {}) {
  const onRemoveAll = vi.fn();

  const props: Props = {
    source: buildSource(),
    domain: buildDomain(),
    onRemoveAll,
    ...overrides,
  };

  const utils = render(<ManagementView {...props} />);
  return { ...utils, onRemoveAll };
}

describe("ManagementView", () => {
  it("renders Active badge for completed migration", () => {
    setup({ source: buildSource({ health: "healthy" }) });
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("does not surface provider health failures on the completed screen", () => {
    setup({
      source: buildSource({
        health: "degraded",
        consecutive_failures: 3,
        last_error_status: 502,
        first_failure_at: "2026-06-01T00:00:00Z",
      }),
    });
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.queryByText("Degraded")).not.toBeInTheDocument();
    expect(screen.queryByText(/502/)).not.toBeInTheDocument();
  });

  it("renders old_host and provider in the header strip", () => {
    setup({
      source: buildSource({
        provider: "appsflyer",
        old_host: "links.example.com",
      }),
    });
    expect(screen.getByText("links.example.com")).toBeInTheDocument();
    expect(screen.getByText(/appsflyer/i)).toBeInTheDocument();
  });

  it("does not render manual test, rotate, pause, or source-remove controls", () => {
    setup();
    expect(
      screen.queryByRole("button", { name: /^test$/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /rotate credentials/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^pause$/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /remove migration source/i })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^remove migration$/i })
    ).toBeInTheDocument();
  });

  it("renders lastVerifiedAt footer when provided", () => {
    setup({ lastVerifiedAt: "2026-05-31T10:00:00Z" });
    expect(screen.getByText(/last verified/i)).toBeInTheDocument();
  });

  it("remove migration dialog requires typing the hostname", async () => {
    const { onRemoveAll } = setup({
      source: buildSource({ old_host: "old.acme.com" }),
    });
    fireEvent.click(
      screen.getByRole("button", { name: /^remove migration$/i })
    );
    const dialog = await screen.findByRole("alertdialog", {
      name: /^remove migration/i,
    });
    const confirmBtn = within(dialog)
      .getByText(/^remove migration$/i)
      .closest("button");
    if (!confirmBtn) throw new Error("confirm button missing");
    expect(confirmBtn).toBeDisabled();

    const input = screen.getByLabelText(/type .* to confirm/i);
    fireEvent.change(input, { target: { value: "wrong" } });
    expect(confirmBtn).toBeDisabled();

    fireEvent.change(input, { target: { value: "old.acme.com" } });
    expect(confirmBtn).not.toBeDisabled();

    fireEvent.click(confirmBtn);
    await waitFor(() => {
      expect(onRemoveAll).toHaveBeenCalledTimes(1);
    });
  });

  it("renders the hostname in the remove dialog as selectable text", async () => {
    setup({
      source: buildSource({ old_host: "old.acme.com" }),
    });
    fireEvent.click(
      screen.getByRole("button", { name: /^remove migration$/i })
    );
    const dialog = await screen.findByRole("alertdialog", {
      name: /^remove migration/i,
    });
    const hostnameSpan = within(dialog).getByText("old.acme.com", {
      selector: "span",
    });
    expect(hostnameSpan).toHaveClass("select-all");
    // Clicking the hostname must not forward label focus to the input
    // (that would drop the text selection mid-copy).
    fireEvent.click(hostnameSpan);
    expect(screen.getByLabelText(/type .* to confirm/i)).not.toHaveFocus();
  });

  it("keeps the remove dialog pending until removal succeeds", async () => {
    let resolveRemove: (value: boolean) => void = () => {};
    const onRemoveAll = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveRemove = resolve;
        })
    );
    setup({
      source: buildSource({ old_host: "old.acme.com" }),
      onRemoveAll,
    });

    fireEvent.click(
      screen.getByRole("button", { name: /^remove migration$/i })
    );
    const dialog = await screen.findByRole("alertdialog", {
      name: /^remove migration/i,
    });
    fireEvent.change(screen.getByLabelText(/type .* to confirm/i), {
      target: { value: "old.acme.com" },
    });

    fireEvent.click(
      within(dialog).getByRole("button", { name: /^remove migration$/i })
    );

    expect(onRemoveAll).toHaveBeenCalledTimes(1);
    expect(
      within(dialog).getByRole("button", { name: /removing/i })
    ).toBeDisabled();
    expect(
      screen.getByRole("alertdialog", { name: /^remove migration/i })
    ).toBeInTheDocument();

    resolveRemove(true);

    await waitFor(() => {
      expect(
        screen.queryByRole("alertdialog", { name: /^remove migration/i })
      ).not.toBeInTheDocument();
    });
  });

  it("keeps the remove dialog open when removal fails", async () => {
    setup({
      source: buildSource({ old_host: "old.acme.com" }),
      onRemoveAll: vi.fn().mockResolvedValue(false),
    });

    fireEvent.click(
      screen.getByRole("button", { name: /^remove migration$/i })
    );
    const dialog = await screen.findByRole("alertdialog", {
      name: /^remove migration/i,
    });
    fireEvent.change(screen.getByLabelText(/type .* to confirm/i), {
      target: { value: "old.acme.com" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: /^remove migration$/i })
    );

    await waitFor(() => {
      expect(
        within(dialog).getByRole("button", { name: /^remove migration$/i })
      ).not.toBeDisabled();
    });
    expect(
      screen.getByRole("alertdialog", { name: /^remove migration/i })
    ).toBeInTheDocument();
  });

  it("cancel closes and resets the remove migration dialog", async () => {
    setup({ source: buildSource({ old_host: "old.acme.com" }) });
    fireEvent.click(
      screen.getByRole("button", { name: /^remove migration$/i })
    );
    const input = await screen.findByLabelText(/type .* to confirm/i);
    fireEvent.change(input, { target: { value: "old.acme.com" } });

    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));

    await waitFor(() => {
      expect(
        screen.queryByRole("alertdialog", { name: /^remove migration/i })
      ).not.toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole("button", { name: /^remove migration$/i })
    );
    expect(await screen.findByLabelText(/type .* to confirm/i)).toHaveValue("");
  });
});
