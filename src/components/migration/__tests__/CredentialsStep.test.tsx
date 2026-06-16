import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import CredentialsStep from "../steps/CredentialsStep";
import type { MigrationTestResponse } from "@/types";

function setup(
  overrides: Partial<React.ComponentProps<typeof CredentialsStep>> = {}
) {
  const onSubmit =
    vi.fn<(credentials: unknown) => Promise<MigrationTestResponse>>();
  // Default: resolve to credentials_ok so happy-path callers don't have to wire it up.
  onSubmit.mockResolvedValue({ outcome: "credentials_ok", http_status: 200 });
  const props: React.ComponentProps<typeof CredentialsStep> = {
    provider: "branch",
    oldHost: "old.acme.com",
    onSubmit,
    isSubmitting: false,
    ...overrides,
  };
  const utils = render(<CredentialsStep {...props} />);
  return { ...utils, onSubmit };
}

describe("CredentialsStep", () => {
  it("renders the read-only oldHost context line", () => {
    setup({ oldHost: "links.example.com" });
    expect(screen.getByText(/links\.example\.com/)).toBeInTheDocument();
  });

  it("renders Branch form (single branch_key field) when provider=branch", () => {
    setup({ provider: "branch" });
    expect(screen.getByLabelText("Branch key")).toBeInTheDocument();
    expect(screen.queryByLabelText("OneLink ID")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("API token")).not.toBeInTheDocument();
  });

  it("renders AppsFlyer form (onelink_id + api_token) when provider=appsflyer", () => {
    setup({ provider: "appsflyer" });
    expect(screen.getByLabelText("OneLink ID")).toBeInTheDocument();
    expect(screen.getByLabelText("API token")).toBeInTheDocument();
    expect(screen.queryByLabelText("Branch key")).not.toBeInTheDocument();
  });

  it("submit (branch) calls onSubmit with parsed branch credentials", async () => {
    const { onSubmit } = setup({ provider: "branch" });
    fireEvent.change(screen.getByLabelText("Branch key"), {
      target: { value: "REMOVED_LEGACY_FIXTURE_01" },
    });
    fireEvent.click(screen.getByRole("button", { name: /verify/i }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(onSubmit).toHaveBeenCalledWith({ branch_key: "REMOVED_LEGACY_FIXTURE_01" });
  });

  it("submit (appsflyer) calls onSubmit with parsed appsflyer credentials", async () => {
    const { onSubmit } = setup({ provider: "appsflyer" });
    fireEvent.change(screen.getByLabelText("OneLink ID"), {
      target: { value: "abc123" },
    });
    fireEvent.change(screen.getByLabelText("API token"), {
      target: { value: "tok_xyz" },
    });
    fireEvent.click(screen.getByRole("button", { name: /verify/i }));
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
    expect(screen.getByRole("button", { name: /verify/i })).toBeDisabled();
  });

  it("submit button disabled while isSubmitting is true", () => {
    setup({ provider: "branch", isSubmitting: true });
    fireEvent.change(screen.getByLabelText("Branch key"), {
      target: { value: "k" },
    });
    expect(screen.getByRole("button", { name: /verify/i })).toBeDisabled();
  });

  it("credentials_ok outcome renders success banner", async () => {
    const onSubmit = vi
      .fn<(c: unknown) => Promise<MigrationTestResponse>>()
      .mockResolvedValue({ outcome: "credentials_ok", http_status: 200 });
    render(
      <CredentialsStep
        provider="branch"
        oldHost="old.acme.com"
        onSubmit={onSubmit}
        isSubmitting={false}
      />
    );
    fireEvent.change(screen.getByLabelText("Branch key"), {
      target: { value: "k" },
    });
    fireEvent.click(screen.getByRole("button", { name: /verify/i }));
    await waitFor(() => {
      expect(
        screen.getByText(/credentials verified — your migration is armed/i)
      ).toBeInTheDocument();
    });
  });

  it("credentials_invalid outcome surfaces inline form error and keeps values", async () => {
    const onSubmit = vi
      .fn<(c: unknown) => Promise<MigrationTestResponse>>()
      .mockResolvedValue({ outcome: "credentials_invalid", http_status: 401 });
    render(
      <CredentialsStep
        provider="branch"
        oldHost="old.acme.com"
        onSubmit={onSubmit}
        isSubmitting={false}
      />
    );
    const input = screen.getByLabelText("Branch key") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "wrong_key" } });
    fireEvent.click(screen.getByRole("button", { name: /verify/i }));
    await waitFor(() => {
      expect(
        screen.getByText(
          /provider rejected these credentials\. double-check the values and try again\./i
        )
      ).toBeInTheDocument();
    });
    // Keep form populated.
    expect(input.value).toBe("wrong_key");

    // Inline error clears on next edit.
    fireEvent.change(input, { target: { value: "wrong_key2" } });
    expect(
      screen.queryByText(/provider rejected these credentials/i)
    ).not.toBeInTheDocument();
  });

  it("upstream_rate_limited outcome renders rate-limited banner", async () => {
    const onSubmit = vi
      .fn<(c: unknown) => Promise<MigrationTestResponse>>()
      .mockResolvedValue({
        outcome: "upstream_rate_limited",
        http_status: 429,
      });
    render(
      <CredentialsStep
        provider="branch"
        oldHost="old.acme.com"
        onSubmit={onSubmit}
        isSubmitting={false}
      />
    );
    fireEvent.change(screen.getByLabelText("Branch key"), {
      target: { value: "k" },
    });
    fireEvent.click(screen.getByRole("button", { name: /verify/i }));
    await waitFor(() => {
      expect(
        screen.getByText(/provider is rate-limiting us/i)
      ).toBeInTheDocument();
    });
  });

  it("upstream_unreachable outcome renders unreachable banner", async () => {
    const onSubmit = vi
      .fn<(c: unknown) => Promise<MigrationTestResponse>>()
      .mockResolvedValue({
        outcome: "upstream_unreachable",
        http_status: 502,
      });
    render(
      <CredentialsStep
        provider="branch"
        oldHost="old.acme.com"
        onSubmit={onSubmit}
        isSubmitting={false}
      />
    );
    fireEvent.change(screen.getByLabelText("Branch key"), {
      target: { value: "k" },
    });
    fireEvent.click(screen.getByRole("button", { name: /verify/i }));
    await waitFor(() => {
      expect(
        screen.getByText(/couldn't reach the provider/i)
      ).toBeInTheDocument();
    });
  });

  it("does not crash and stays interactive when onSubmit rejects", async () => {
    // The wizard re-throws after toasting; the child must swallow the
    // rejection so it doesn't surface as an unhandled promise. The form
    // should remain interactive (button re-enables once values exist).
    const onSubmit = vi
      .fn<(c: unknown) => Promise<MigrationTestResponse>>()
      .mockRejectedValue(new Error("boom"));
    render(
      <CredentialsStep
        provider="branch"
        oldHost="old.acme.com"
        onSubmit={onSubmit}
        isSubmitting={false}
      />
    );
    const input = screen.getByLabelText("Branch key") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "key_live_abc" } });
    fireEvent.click(screen.getByRole("button", { name: /verify/i }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    // No outcome banner — error was swallowed without setting outcome.
    expect(screen.queryByText(/credentials verified/i)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/provider rejected these credentials/i)
    ).not.toBeInTheDocument();
    // Form is still interactive: input retains value, button is enabled.
    expect(input.value).toBe("key_live_abc");
    expect(screen.getByRole("button", { name: /verify/i })).toBeEnabled();
  });

  it("unexpected_success outcome shows the support-hint copy", async () => {
    const onSubmit = vi
      .fn<(c: unknown) => Promise<MigrationTestResponse>>()
      .mockResolvedValue({
        outcome: "unexpected_success",
        http_status: 200,
      });
    render(
      <CredentialsStep
        provider="branch"
        oldHost="old.acme.com"
        onSubmit={onSubmit}
        isSubmitting={false}
      />
    );
    fireEvent.change(screen.getByLabelText("Branch key"), {
      target: { value: "k" },
    });
    fireEvent.click(screen.getByRole("button", { name: /verify/i }));
    await waitFor(() => {
      expect(
        screen.getByText(/inconclusive result — please contact support/i)
      ).toBeInTheDocument();
    });
  });
});
