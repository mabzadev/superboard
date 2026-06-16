import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import StartStep from "../steps/StartStep";

// Radix's <RadioGroupIndicator> uses useSize → ResizeObserver, which jsdom
// doesn't ship. Stub it once for this suite.
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

function setup(
  overrides: Partial<React.ComponentProps<typeof StartStep>> = {}
) {
  const onSubmit = vi.fn();
  const utils = render(<StartStep onSubmit={onSubmit} {...overrides} />);
  return { ...utils, onSubmit };
}

function chooseProvider(name: RegExp) {
  fireEvent.click(
    screen.getByRole("button", { name: /select source platform/i })
  );
  fireEvent.click(screen.getByRole("button", { name }));
}

describe("StartStep", () => {
  it("renders the provider dropdown and neutral subdomain field on mount", () => {
    setup();
    expect(
      screen.getByRole("button", { name: /select source platform/i })
    ).toBeInTheDocument();
    expect(screen.getAllByText(/branch or appsflyer/i).length).toBeGreaterThan(
      0
    );
    expect(screen.getByLabelText(/provider subdomain/i)).toBeInTheDocument();
  });

  it("reveals credentials fields only after a provider is chosen", () => {
    setup();
    expect(screen.queryByLabelText("Branch key")).not.toBeInTheDocument();
    chooseProvider(/branch/i);
    expect(screen.getByLabelText("Branch key")).toBeInTheDocument();
  });

  it("switches credentials fields when provider changes", () => {
    setup();
    chooseProvider(/branch/i);
    expect(screen.getByLabelText("Branch key")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /select source platform/i })
    );
    fireEvent.click(screen.getByRole("button", { name: /appsflyer/i }));
    expect(screen.getByLabelText("OneLink ID")).toBeInTheDocument();
    expect(screen.getByLabelText("API token")).toBeInTheDocument();
    expect(screen.getByLabelText(/appsflyer subdomain/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Branch key")).not.toBeInTheDocument();
  });

  it("submit is disabled until provider + credentials + hostname are all valid", () => {
    setup();
    const submit = screen.getByRole("button", { name: /start migration/i });
    expect(submit).toBeDisabled();

    chooseProvider(/branch/i);
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Branch key"), {
      target: { value: "key_live_abc" },
    });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/branch subdomain/i), {
      target: { value: "old.acme.com" },
    });
    expect(submit).not.toBeDisabled();
  });

  it("submit calls onSubmit with branch credentials, provider, and hostname", async () => {
    const { onSubmit } = setup();
    chooseProvider(/branch/i);
    fireEvent.change(screen.getByLabelText("Branch key"), {
      target: { value: "REMOVED_LEGACY_FIXTURE_01" },
    });
    fireEvent.change(screen.getByLabelText(/branch subdomain/i), {
      target: { value: "old.acme.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /start migration/i }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(onSubmit).toHaveBeenCalledWith({
      provider: "branch",
      hostname: "old.acme.com",
      credentials: { branch_key: "REMOVED_LEGACY_FIXTURE_01" },
    });
  });

  it("submit calls onSubmit with appsflyer credentials when chosen", async () => {
    const { onSubmit } = setup();
    chooseProvider(/appsflyer/i);
    fireEvent.change(screen.getByLabelText("OneLink ID"), {
      target: { value: "abc123" },
    });
    fireEvent.change(screen.getByLabelText("API token"), {
      target: { value: "tok_xyz" },
    });
    fireEvent.change(screen.getByLabelText(/appsflyer subdomain/i), {
      target: { value: "links.acme.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /start migration/i }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(onSubmit).toHaveBeenCalledWith({
      provider: "appsflyer",
      hostname: "links.acme.com",
      credentials: { onelink_id: "abc123", api_token: "tok_xyz" },
    });
  });

  it("invalid hostname surfaces an inline error and keeps submit disabled", () => {
    setup();
    chooseProvider(/branch/i);
    fireEvent.change(screen.getByLabelText("Branch key"), {
      target: { value: "key_live_abc" },
    });
    fireEvent.change(screen.getByLabelText(/branch subdomain/i), {
      target: { value: "https://x" },
    });
    const submit = screen.getByRole("button", { name: /start migration/i });
    expect(submit).toBeDisabled();
    expect(
      screen.getByText(/don't include http\(s\):\/\//i)
    ).toBeInTheDocument();
  });

  it("disables the submit button while isSubmitting is true", () => {
    setup({ isSubmitting: true });
    chooseProvider(/branch/i);
    fireEvent.change(screen.getByLabelText("Branch key"), {
      target: { value: "k" },
    });
    fireEvent.change(screen.getByLabelText(/branch subdomain/i), {
      target: { value: "old.acme.com" },
    });
    expect(screen.getByRole("button", { name: /starting/i })).toBeDisabled();
  });

  it("renders the supplied cancelSlot inline with the submit row", () => {
    setup({ cancelSlot: <button type="button">Cancel migration</button> });
    expect(
      screen.getByRole("button", { name: /cancel migration/i })
    ).toBeInTheDocument();
  });
});
