import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import AppPreflightStep from "../steps/AppPreflightStep";

function setup(
  overrides: Partial<React.ComponentProps<typeof AppPreflightStep>> = {}
) {
  const onContinue = vi.fn();
  const props: React.ComponentProps<typeof AppPreflightStep> = {
    oldHost: "old.acme.com",
    ios: true,
    android: true,
    onContinue,
    ...overrides,
  };
  const utils = render(<AppPreflightStep {...props} />);
  return { ...utils, onContinue };
}

describe("AppPreflightStep", () => {
  it("renders the DNS-regression warning callout", () => {
    setup();
    expect(
      screen.getByText(
        /flipping dns before the new build is live regresses universal links/i
      )
    ).toBeInTheDocument();
  });

  it("only renders iOS section when ios: true", () => {
    const { rerender } = setup({ ios: true, android: false });
    expect(
      screen.getByRole("checkbox", { name: /associated domains entitlement/i })
    ).toBeInTheDocument();

    rerender(
      <AppPreflightStep
        oldHost="old.acme.com"
        ios={false}
        android={true}
        onContinue={() => {}}
      />
    );
    expect(
      screen.queryByRole("checkbox", {
        name: /associated domains entitlement/i,
      })
    ).not.toBeInTheDocument();
  });

  it("only renders Android section when android: true", () => {
    const { rerender } = setup({ ios: false, android: true });
    expect(
      screen.getByRole("checkbox", { name: /assetlinks\.json/i })
    ).toBeInTheDocument();

    rerender(
      <AppPreflightStep
        oldHost="old.acme.com"
        ios={true}
        android={false}
        onContinue={() => {}}
      />
    );
    expect(
      screen.queryByRole("checkbox", { name: /assetlinks\.json/i })
    ).not.toBeInTheDocument();
  });

  it("renders the common 'users have had time to update' item whenever a platform applies", () => {
    setup({ ios: true, android: false });
    expect(
      screen.getByRole("checkbox", {
        name: /users have had time to update to the new build/i,
      })
    ).toBeInTheDocument();
  });

  it("interpolates oldHost into the iOS applinks copy", () => {
    setup({ ios: true, android: false, oldHost: "links.example.com" });
    expect(
      screen.getByText(/applinks:links\.example\.com/i)
    ).toBeInTheDocument();
  });

  it("Continue stays disabled until every visible checkbox is ticked", () => {
    setup({ ios: true, android: true });
    const submit = screen.getByRole("button", { name: /continue/i });
    expect(submit).toBeDisabled();

    const iosBox = screen.getByRole("checkbox", {
      name: /associated domains entitlement/i,
    });
    const androidBox = screen.getByRole("checkbox", {
      name: /assetlinks\.json/i,
    });
    const commonBox = screen.getByRole("checkbox", {
      name: /users have had time to update to the new build/i,
    });

    fireEvent.click(iosBox);
    expect(submit).toBeDisabled();

    fireEvent.click(androidBox);
    expect(submit).toBeDisabled();

    fireEvent.click(commonBox);
    expect(submit).not.toBeDisabled();
  });

  it("Continue invokes onContinue once all relevant boxes are ticked", () => {
    const { onContinue } = setup({ ios: false, android: true });

    fireEvent.click(
      screen.getByRole("checkbox", { name: /assetlinks\.json/i })
    );
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /users have had time to update to the new build/i,
      })
    );

    const submit = screen.getByRole("button", { name: /continue/i });
    expect(submit).not.toBeDisabled();
    fireEvent.click(submit);
    expect(onContinue).toHaveBeenCalledTimes(1);
  });
});
