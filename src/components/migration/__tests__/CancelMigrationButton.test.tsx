import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import CancelMigrationButton from "../CancelMigrationButton";

describe("CancelMigrationButton", () => {
  it("renders a 'Cancel migration' button", () => {
    render(<CancelMigrationButton onCancel={() => {}} />);
    expect(
      screen.getByRole("button", { name: /cancel migration/i })
    ).toBeInTheDocument();
  });

  it("no-confirm mode (no hostname): clicking fires onCancel immediately", () => {
    const onCancel = vi.fn();
    render(<CancelMigrationButton onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: /cancel migration/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    // No dialog mounted.
    expect(
      screen.queryByRole("alertdialog", { name: /cancel migration\?/i })
    ).not.toBeInTheDocument();
  });

  it("confirm mode (hostname set): clicking opens the dialog without firing onCancel", () => {
    const onCancel = vi.fn();
    render(
      <CancelMigrationButton hostname="old.acme.com" onCancel={onCancel} />
    );
    fireEvent.click(screen.getByRole("button", { name: /cancel migration/i }));
    expect(
      screen.getByRole("alertdialog", { name: /cancel migration\?/i })
    ).toBeInTheDocument();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("confirm-mode action stays disabled until the hostname matches", () => {
    render(
      <CancelMigrationButton hostname="old.acme.com" onCancel={() => {}} />
    );
    fireEvent.click(screen.getByRole("button", { name: /cancel migration/i }));

    // The destructive action button inside the dialog (different from the
    // trigger that opens it).
    const confirmButtons = screen.getAllByRole("button", {
      name: /cancel migration/i,
    });
    const dialogAction = confirmButtons[confirmButtons.length - 1];
    if (!dialogAction) throw new Error("dialog action button not found");
    expect(dialogAction).toBeDisabled();

    const input = screen.getByLabelText(/type.*to confirm/i);
    fireEvent.change(input, { target: { value: "wrong" } });
    expect(dialogAction).toBeDisabled();

    fireEvent.change(input, { target: { value: "old.acme.com" } });
    expect(dialogAction).not.toBeDisabled();
  });

  it("renders the hostname as selectable text despite the label's select-none", () => {
    render(
      <CancelMigrationButton hostname="old.acme.com" onCancel={() => {}} />
    );
    fireEvent.click(screen.getByRole("button", { name: /cancel migration/i }));
    const hostnameSpan = screen.getByText("old.acme.com", { selector: "span" });
    expect(hostnameSpan).toHaveClass("select-all");
    // Clicking the hostname must not forward label focus to the input
    // (that would drop the text selection mid-copy).
    fireEvent.click(hostnameSpan);
    expect(screen.getByLabelText(/type.*to confirm/i)).not.toHaveFocus();
  });

  it("confirming fires onCancel and closes the dialog", async () => {
    const onCancel = vi.fn().mockResolvedValue(undefined);
    render(
      <CancelMigrationButton hostname="old.acme.com" onCancel={onCancel} />
    );
    fireEvent.click(screen.getByRole("button", { name: /cancel migration/i }));

    const input = screen.getByLabelText(/type.*to confirm/i);
    fireEvent.change(input, { target: { value: "old.acme.com" } });

    const actionButtons = screen.getAllByRole("button", {
      name: /cancel migration/i,
    });
    const dialogAction = actionButtons[actionButtons.length - 1];
    if (!dialogAction) throw new Error("dialog action button not found");
    fireEvent.click(dialogAction);

    await waitFor(() => {
      expect(onCancel).toHaveBeenCalledTimes(1);
    });
  });

  it("hostname match is case-insensitive and trims", () => {
    const onCancel = vi.fn().mockResolvedValue(undefined);
    render(
      <CancelMigrationButton hostname="Old.Acme.com" onCancel={onCancel} />
    );
    fireEvent.click(screen.getByRole("button", { name: /cancel migration/i }));

    const input = screen.getByLabelText(/type.*to confirm/i);
    fireEvent.change(input, { target: { value: "  old.acme.com  " } });

    const actionButtons = screen.getAllByRole("button", {
      name: /cancel migration/i,
    });
    const dialogAction = actionButtons[actionButtons.length - 1];
    if (!dialogAction) throw new Error("dialog action button not found");
    expect(dialogAction).not.toBeDisabled();
  });

  it("disabled while isCancelling is true (no-confirm mode)", () => {
    render(<CancelMigrationButton onCancel={() => {}} isCancelling />);
    expect(
      screen.getByRole("button", { name: /cancelling migration/i })
    ).toBeDisabled();
  });

  it("shows pending copy while isCancelling is true in confirm mode", () => {
    render(
      <CancelMigrationButton
        hostname="old.acme.com"
        onCancel={() => {}}
        isCancelling
      />
    );
    expect(
      screen.getByRole("button", { name: /cancelling migration/i })
    ).toBeDisabled();
  });
});
