import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { LoginForm } from "../loginForm/login-form";
import { loginSchema, type LoginFormValues } from "@/schemas/auth";

vi.mock("@/lib/config", () => ({
  config: {
    apiUrl: "https://test.example.com",
    apiPath: "/api/v1",
    clientId: "test-client-id",
    docsUrl: "https://docs.example.com",
    supportEmail: "support@example.com",
  },
}));

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

function TestLoginForm(
  overrides: Partial<Parameters<typeof LoginForm>[0]> = {}
) {
  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "", otp: "" },
    mode: "onChange",
  });

  const defaults = {
    form,
    otpEnabled: false,
    handleLogin: vi.fn(),
    ...overrides,
  };

  return <LoginForm {...defaults} />;
}

describe("LoginForm", () => {
  it("renders email and password fields", () => {
    render(<TestLoginForm />);

    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
  });

  it("does not render OTP field when otpEnabled is false", () => {
    render(<TestLoginForm otpEnabled={false} />);

    expect(screen.queryByLabelText("OTP")).not.toBeInTheDocument();
  });

  it("renders OTP field when otpEnabled is true", () => {
    render(<TestLoginForm otpEnabled={true} />);

    expect(screen.getByLabelText("OTP")).toBeInTheDocument();
  });

  it("does not render SSO buttons", () => {
    render(<TestLoginForm />);

    expect(screen.queryByText("Login with Google")).not.toBeInTheDocument();
    expect(screen.queryByText("Login with Microsoft")).not.toBeInTheDocument();
  });

  it("does not render legal consent links", () => {
    render(<TestLoginForm />);

    expect(screen.queryByText(/By clicking continue/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Terms of Service")).not.toBeInTheDocument();
    expect(screen.queryByText("Privacy Policy")).not.toBeInTheDocument();
  });

  it("submit button is disabled when form is invalid", () => {
    render(<TestLoginForm />);

    const button = screen.getByRole("button", { name: "Login" });
    expect(button).toBeDisabled();
  });

  it("renders forgot password and sign up links", () => {
    render(<TestLoginForm />);

    expect(screen.getByText("Forgot your password?")).toBeInTheDocument();
    expect(screen.getByText("Sign up")).toBeInTheDocument();
  });
});
