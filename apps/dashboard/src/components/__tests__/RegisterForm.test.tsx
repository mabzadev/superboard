import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { RegisterForm } from "../registerForm/RegisterForm";
import { registerSchema, type RegisterFormValues } from "@/schemas/auth";

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

vi.mock("react-password-checklist", () => ({
  default: ({ onChange }: { onChange: (valid: boolean) => void }) => {
    void onChange;
    return <div data-testid="password-checklist">Password Checklist</div>;
  },
}));

function TestRegisterForm(
  overrides: Partial<Parameters<typeof RegisterForm>[0]> = {}
) {
  const form = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: "", email: "", password: "", password_confirm: "" },
    mode: "onChange",
  });

  const defaults = {
    form,
    handleRegister: vi.fn(),
    showConditions: true,
    setPasswordRulesValid: vi.fn(),
    passwordRulesValid: false,
    ...overrides,
  };

  return <RegisterForm {...defaults} />;
}

describe("RegisterForm", () => {
  it("renders name, email, password, and confirm password fields", () => {
    render(<TestRegisterForm />);

    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByLabelText("Confirm password")).toBeInTheDocument();
  });

  it("hides email field when acceptInvite is true", () => {
    render(<TestRegisterForm acceptInvite={true} />);

    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
  });

  it("shows email field when acceptInvite is false", () => {
    render(<TestRegisterForm acceptInvite={false} />);

    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });

  it("submit button is disabled when form is invalid", () => {
    render(<TestRegisterForm />);

    const button = screen.getByRole("button", { name: "Get started" });
    expect(button).toBeDisabled();
  });

  it("submit button is disabled when passwordRulesValid is false", () => {
    render(<TestRegisterForm passwordRulesValid={false} />);

    const button = screen.getByRole("button", { name: "Get started" });
    expect(button).toBeDisabled();
  });

  it("shows password checklist when showConditions is true", () => {
    render(<TestRegisterForm showConditions={true} />);

    const checklist = screen.getByTestId("password-checklist");
    expect(checklist.parentElement).toHaveClass("visible");
  });

  it("hides password checklist when showConditions is false", () => {
    render(<TestRegisterForm showConditions={false} />);

    const checklist = screen.getByTestId("password-checklist");
    expect(checklist.parentElement).toHaveClass("hidden");
  });

  it("renders page title", () => {
    render(<TestRegisterForm />);

    expect(screen.getByText("Create your account")).toBeInTheDocument();
  });
});
