import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import RotateCredentialsDialog from "../RotateCredentialsDialog";
import type { MigrationTestResponse } from "@/types";

type Props = React.ComponentProps<typeof RotateCredentialsDialog>;

function setup(overrides: Partial<Props> = {}) {
  const onClose = vi.fn();
  const onSubmit = vi
    .fn<(c: unknown) => Promise<MigrationTestResponse>>()
    .mockResolvedValue({ outcome: "credentials_ok", http_status: 200 });

  const props: Props = {
    provider: "branch",
    isOpen: true,
    onClose,
    onSubmit,
    isSubmitting: false,
    ...overrides,
  };

  const utils = render(<RotateCredentialsDialog {...props} />);
  return { ...utils, onSubmit, onClose };
}

describe("RotateCredentialsDialog", () => {
  it("renders nothing when isOpen is false", () => {
    setup({ isOpen: false });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens with an empty branch form when provider=branch", () => {
    setup({ provider: "branch" });
    const input = screen.getByLabelText("Branch key") as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.value).toBe("");
  });

  it("opens with empty appsflyer fields when provider=appsflyer", () => {
    setup({ provider: "appsflyer" });
    const onelink = screen.getByLabelText("OneLink ID") as HTMLInputElement;
    const token = screen.getByLabelText("API token") as HTMLInputElement;
    expect(onelink.value).toBe("");
    expect(token.value).toBe("");
  });

  it("submit calls onSubmit with parsed branch credentials", async () => {
    const { onSubmit } = setup({ provider: "branch" });
    fireEvent.change(screen.getByLabelText("Branch key"), {
      target: { value: "new_key_123" },
    });
    fireEvent.click(screen.getByRole("button", { name: /rotate/i }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(onSubmit).toHaveBeenCalledWith({ branch_key: "new_key_123" });
  });

  it("submit calls onSubmit with parsed appsflyer credentials", async () => {
    const { onSubmit } = setup({ provider: "appsflyer" });
    fireEvent.change(screen.getByLabelText("OneLink ID"), {
      target: { value: "abc123" },
    });
    fireEvent.change(screen.getByLabelText("API token"), {
      target: { value: "tok_xyz" },
    });
    fireEvent.click(screen.getByRole("button", { name: /rotate/i }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(onSubmit).toHaveBeenCalledWith({
      onelink_id: "abc123",
      api_token: "tok_xyz",
    });
  });

  it("submit button disabled while form is invalid", () => {
    setup({ provider: "branch" });
    expect(screen.getByRole("button", { name: /rotate/i })).toBeDisabled();
  });

  it("submit button disabled while isSubmitting", () => {
    setup({ provider: "branch", isSubmitting: true });
    fireEvent.change(screen.getByLabelText("Branch key"), {
      target: { value: "k" },
    });
    expect(screen.getByRole("button", { name: /rotat/i })).toBeDisabled();
  });

  it("surfaces credentials_ok outcome after submit", async () => {
    const onSubmit = vi
      .fn<(c: unknown) => Promise<MigrationTestResponse>>()
      .mockResolvedValue({ outcome: "credentials_ok", http_status: 200 });
    render(
      <RotateCredentialsDialog
        provider="branch"
        isOpen
        onClose={() => {}}
        onSubmit={onSubmit}
        isSubmitting={false}
      />
    );
    fireEvent.change(screen.getByLabelText("Branch key"), {
      target: { value: "k" },
    });
    fireEvent.click(screen.getByRole("button", { name: /rotate/i }));
    await waitFor(() => {
      expect(screen.getByText(/credentials verified/i)).toBeInTheDocument();
    });
  });

  it("surfaces credentials_invalid outcome as form-level error", async () => {
    const onSubmit = vi
      .fn<(c: unknown) => Promise<MigrationTestResponse>>()
      .mockResolvedValue({ outcome: "credentials_invalid", http_status: 401 });
    render(
      <RotateCredentialsDialog
        provider="branch"
        isOpen
        onClose={() => {}}
        onSubmit={onSubmit}
        isSubmitting={false}
      />
    );
    const input = screen.getByLabelText("Branch key") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: /rotate/i }));
    await waitFor(() => {
      expect(
        screen.getByText(/provider rejected these credentials/i)
      ).toBeInTheDocument();
    });
    expect(input.value).toBe("wrong");
  });

  it("does not crash and stays interactive when onSubmit rejects", async () => {
    // The parent re-throws after toasting; the dialog must swallow the
    // rejection so it doesn't surface as an unhandled promise. The form
    // should remain interactive (button re-enables once values exist).
    const onSubmit = vi
      .fn<(c: unknown) => Promise<MigrationTestResponse>>()
      .mockRejectedValue(new Error("boom"));
    render(
      <RotateCredentialsDialog
        provider="branch"
        isOpen
        onClose={() => {}}
        onSubmit={onSubmit}
        isSubmitting={false}
      />
    );
    const input = screen.getByLabelText("Branch key") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "new_key" } });
    fireEvent.click(screen.getByRole("button", { name: /rotate/i }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    // No outcome banner — error was swallowed without setting outcome.
    expect(screen.queryByText(/credentials verified/i)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/provider rejected these credentials/i)
    ).not.toBeInTheDocument();
    // Form is still interactive: input retains value, button is enabled.
    expect(input.value).toBe("new_key");
    expect(screen.getByRole("button", { name: /rotate/i })).toBeEnabled();
  });

  it("cancel button calls onClose", () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
