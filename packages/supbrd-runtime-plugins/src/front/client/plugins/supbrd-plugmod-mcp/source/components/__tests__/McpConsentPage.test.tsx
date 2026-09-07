const registration = vi.hoisted(() => ({ GET: vi.fn() }));
vi.mock("../../../transport.js", () => registration);
import { createElement } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
	render,
	screen,
	fireEvent,
	waitFor,
} from "../../../../../../../../../supbrd-front-ui/tests/render.js";

// --- Mocks must be declared before imports ---

const mockPush = vi.fn();
const mockReplace = vi.fn();
const mockSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
	useRouter: () => ({
		push: mockPush,
		replace: mockReplace,
	}),
	useSearchParams: () => mockSearchParams,
}));

vi.mock("../../api/auth/userService.js", () => ({
	currentUserAPICall: vi.fn(),
}));

vi.mock("../../api/mcp/mcpService.js", () => ({
	approveConsentAPICall: vi.fn(),
}));

vi.mock("next/image", () => ({
	default: (props: Record<string, unknown>) => {
		const { src, ...rest } = props;
		return createElement("img", { alt: "", src: typeof src === "string" ? src : "", ...rest });
	},
}));

vi.mock("../../../../../../../../../supbrd-front-ui/src/shared/lib/ApiError.js", () => ({
	ApiError: class ApiError extends Error {
		constructor(
			message: string,
			public status: number,
		) {
			super(message);
			this.name = "ApiError";
		}
	},
}));

import { currentUserAPICall } from "../../api/auth/userService.js";
import { approveConsentAPICall } from "../../api/mcp/mcpService.js";
import McpAuthorizePage from "../../app/mcp/authorize/page.js";

const mockedGetUser = vi.mocked(currentUserAPICall);
const mockedApproveConsent = vi.mocked(approveConsentAPICall);

function setSearchParams(params: Record<string, string>) {
	// Clear existing params
	Array.from(mockSearchParams.keys()).forEach((key) => mockSearchParams.delete(key));
	Object.entries(params).forEach(([key, value]) => mockSearchParams.set(key, value));
}

const VALID_PARAMS = {
	client_id: "abc-123-uuid",
	client_name: "Claude Desktop",
	redirect_uri: "http://localhost:3456/callback",
	code_challenge: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
	code_challenge_method: "S256",
	state: "random-state-123",
	scope: "mcp:full",
};

describe("McpAuthorizePage (consent)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		setSearchParams(VALID_PARAMS);

		// Default: user is authenticated
		registration.GET.mockImplementation(async (path: string) => {
			const requested = new URL(path, "https://site.test");
			if (requested.searchParams.get("redirect_uri") !== VALID_PARAMS.redirect_uri)
				throw new Error("Unregistered callback");
			return {
				data: {
					client_id: VALID_PARAMS.client_id,
					name: "Claude Desktop",
					redirect_uri: VALID_PARAMS.redirect_uri,
				},
			};
		});
		localStorage.setItem("access_token", "retired-dashboard-token");
		mockedGetUser.mockResolvedValue({
			data: { user: { id: 1, email: "user@example.com" } },
		} as never);

		// Mock window.location
		Object.defineProperty(window, "location", {
			writable: true,
			value: {
				href: "",
				pathname: "/mcp/authorize",
				search: "?" + new URLSearchParams(VALID_PARAMS).toString(),
			},
		});
	});

	// --- Auth check ---

	it("uses the server operator without consulting a browser token", async () => {
		localStorage.removeItem("access_token");
		render(<McpAuthorizePage />);
		expect(await screen.findByText("operator@example.test")).toBeInTheDocument();
		expect(mockedGetUser).not.toHaveBeenCalled();
	});
	it("refuses approval when the client registry rejects the request", async () => {
		registration.GET.mockRejectedValueOnce(new Error("Unregistered client"));
		render(<McpAuthorizePage />);
		expect(
			await screen.findByText("The application or return address is not registered."),
		).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Authorize" })).toBeDisabled();
	});

	// --- Rendering ---

	it("displays the client name returned by the registry instead of its raw ID", async () => {
		render(<McpAuthorizePage />);
		await waitFor(() => {
			expect(screen.getByText("Claude Desktop")).toBeInTheDocument();
		});
		// Should NOT show the raw UUID
		expect(screen.queryByText("abc-123-uuid")).not.toBeInTheDocument();
	});

	it("uses the registered name when the query client_name is absent", async () => {
		setSearchParams({ ...VALID_PARAMS, client_name: "" });
		render(<McpAuthorizePage />);
		await waitFor(() => {
			expect(screen.getByText("Claude Desktop")).toBeInTheDocument();
		});
	});

	it("displays user email after loading", async () => {
		render(<McpAuthorizePage />);
		await waitFor(() => {
			expect(screen.getByText("operator@example.test")).toBeInTheDocument();
		});
	});

	it("shows redirect host from redirect_uri", async () => {
		render(<McpAuthorizePage />);
		await waitFor(() => {
			expect(screen.getByText(/localhost:3456/)).toBeInTheDocument();
		});
	});

	it("does not crash on malformed redirect_uri (host display)", async () => {
		setSearchParams({ ...VALID_PARAMS, redirect_uri: "not-a-url" });
		render(<McpAuthorizePage />);
		await waitFor(() => {
			expect(screen.getByText("Authorize Connection")).toBeInTheDocument();
		});
		// Should not show any "Redirecting to" text
		expect(screen.queryByText(/Redirecting to/)).not.toBeInTheDocument();
	});

	it("shows Authorize and Deny buttons", async () => {
		render(<McpAuthorizePage />);
		await waitFor(() => {
			expect(screen.getByRole("button", { name: "Authorize" })).toBeInTheDocument();
		});
		expect(screen.getByRole("button", { name: /Deny/ })).toBeInTheDocument();
	});

	it("shows permission scope list", async () => {
		render(<McpAuthorizePage />);
		await waitFor(() => {
			expect(screen.getByText("View your projects and instances")).toBeInTheDocument();
		});
		expect(screen.getByText("Create and manage links")).toBeInTheDocument();
		expect(screen.getByText("View analytics data")).toBeInTheDocument();
		expect(screen.getByText("Configure redirects and SDK settings")).toBeInTheDocument();
	});

	// --- Approve flow ---

	it("calls approveConsentAPICall with correct params on Authorize click", async () => {
		mockedApproveConsent.mockResolvedValueOnce({
			data: {
				code: "auth-code-xyz",
				redirect_uri: "http://localhost:3456/callback",
				state: "random-state-123",
			},
		} as never);

		render(<McpAuthorizePage />);
		await waitFor(() => {
			expect(screen.getByRole("button", { name: "Authorize" })).toBeInTheDocument();
		});

		fireEvent.click(screen.getByRole("button", { name: "Authorize" }));

		await waitFor(() => {
			expect(mockedApproveConsent).toHaveBeenCalledWith({
				client_id: "abc-123-uuid",
				redirect_uri: "http://localhost:3456/callback",
				code_challenge: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
				code_challenge_method: "S256",
				state: "random-state-123",
				scope: "mcp:full",
			});
		});
	});

	it("redirects to callback with code and state after approve", async () => {
		mockedApproveConsent.mockResolvedValueOnce({
			data: {
				code: "auth-code-xyz",
				redirect_uri: "http://localhost:3456/callback",
				state: "random-state-123",
			},
		} as never);

		render(<McpAuthorizePage />);
		await waitFor(() => {
			expect(screen.getByRole("button", { name: "Authorize" })).toBeInTheDocument();
		});

		fireEvent.click(screen.getByRole("button", { name: "Authorize" }));

		await waitFor(() => {
			expect(window.location.href).toContain("http://localhost:3456/callback");
			expect(window.location.href).toContain("code=auth-code-xyz");
			expect(window.location.href).toContain("state=random-state-123");
		});
	});

	it("shows button loading state during submission", async () => {
		// Never resolve — keep it pending
		mockedApproveConsent.mockReturnValue(new Promise(() => {}));

		render(<McpAuthorizePage />);
		await waitFor(() => {
			expect(screen.getByRole("button", { name: "Authorize" })).toBeInTheDocument();
		});

		fireEvent.click(screen.getByRole("button", { name: "Authorize" }));

		await waitFor(() => {
			expect(screen.getByText("Authorizing...")).toBeInTheDocument();
		});
	});

	it("shows API error message on approve failure", async () => {
		const { ApiError } =
			await import("../../../../../../../../../supbrd-front-ui/src/shared/lib/ApiError.js");
		mockedApproveConsent.mockRejectedValueOnce(
			new ApiError("redirect_uri not registered for this client", 400),
		);

		render(<McpAuthorizePage />);
		await waitFor(() => {
			expect(screen.getByRole("button", { name: "Authorize" })).toBeInTheDocument();
		});

		fireEvent.click(screen.getByRole("button", { name: "Authorize" }));

		await waitFor(() => {
			expect(screen.getByText("redirect_uri not registered for this client")).toBeInTheDocument();
		});
	});

	it("shows generic error for non-ApiError failures", async () => {
		mockedApproveConsent.mockRejectedValueOnce(new Error("Network failure"));

		render(<McpAuthorizePage />);
		await waitFor(() => {
			expect(screen.getByRole("button", { name: "Authorize" })).toBeInTheDocument();
		});

		fireEvent.click(screen.getByRole("button", { name: "Authorize" }));

		await waitFor(() => {
			expect(screen.getByText("Something went wrong. Please try again.")).toBeInTheDocument();
		});
	});

	// --- Deny flow ---

	it("redirects to callback with error=access_denied on Deny", async () => {
		render(<McpAuthorizePage />);
		await waitFor(() => {
			expect(screen.getByRole("button", { name: /Deny/ })).toBeInTheDocument();
		});

		fireEvent.click(screen.getByRole("button", { name: /Deny/ }));

		expect(window.location.href).toContain("error=access_denied");
		expect(window.location.href).toContain("state=random-state-123");
	});

	it("deny with malformed redirect_uri shows error instead of crashing", async () => {
		setSearchParams({ ...VALID_PARAMS, redirect_uri: "not-a-url" });

		render(<McpAuthorizePage />);
		await waitFor(() => {
			expect(screen.getByRole("button", { name: /Deny/ })).toBeInTheDocument();
		});

		// Should not throw — should show error
		fireEvent.click(screen.getByRole("button", { name: /Deny/ }));

		await waitFor(() => {
			expect(
				screen.getByText("The application or return address is not registered."),
			).toBeInTheDocument();
		});
	});
});
