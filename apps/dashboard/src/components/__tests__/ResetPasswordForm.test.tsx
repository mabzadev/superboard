import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ResetPasswordForm } from "../resetPasswordForm/ResetPasswordForm";
import {
  resetPasswordSchema,
  type ResetPasswordFormValues,
} from "@/schemas/auth";

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...rest
  }: {
    children: React.ReactNode;
    href: string;
    [key: string]: unknown;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

function TestResetPasswordForm(
  overrides: Partial<Parameters<typeof ResetPasswordForm>[0]> = {}
) {
  const form = useForm<ResetPasswordFormValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { email: "" },
    mode: "onChange",
  });

  const defaults = {
    form,
    handleResetPassword: vi.fn(),
    linkSent: false,
    ...overrides,
  };

  return <ResetPasswordForm {...defaults} />;
}

describe("ResetPasswordForm", () => {
  it("renders email field", () => {
    render(<TestResetPasswordForm />);

    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });

  it("shows 'Reset password' title when linkSent is false", () => {
    render(<TestResetPasswordForm linkSent={false} />);

    expect(screen.getByText("Reset password")).toBeInTheDocument();
  });

  it("shows 'Check your e-mail!' title when linkSent is true", () => {
    render(<TestResetPasswordForm linkSent={true} />);

    expect(screen.getByText("Check your e-mail!")).toBeInTheDocument();
  });

  it("shows 'Send link' button when linkSent is false", () => {
    render(<TestResetPasswordForm linkSent={false} />);

    expect(
      screen.getByRole("button", { name: "Send link" })
    ).toBeInTheDocument();
  });

  it("shows 'Send again' button when linkSent is true", () => {
    render(<TestResetPasswordForm linkSent={true} />);

    expect(
      screen.getByRole("button", { name: "Send again" })
    ).toBeInTheDocument();
  });

  it("shows 'Did not receive' link only when linkSent is true", () => {
    const { rerender } = render(<TestResetPasswordForm linkSent={false} />);

    expect(screen.queryByText(/Did not receive/)).not.toBeInTheDocument();

    rerender(<TestResetPasswordForm linkSent={true} />);
    expect(screen.getByText(/Did not receive/)).toBeInTheDocument();
  });

  it("submit button is disabled when form is invalid", () => {
    render(<TestResetPasswordForm linkSent={false} />);

    const button = screen.getByRole("button", { name: "Send link" });
    expect(button).toBeDisabled();
  });

  it("renders create account link", () => {
    render(<TestResetPasswordForm />);

    expect(screen.getByText("Create an account")).toBeInTheDocument();
  });
});
