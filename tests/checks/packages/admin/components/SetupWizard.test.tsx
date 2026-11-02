import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { render } from "../utils/render.tsx";

let mockSeedInfo: any = null;

vi.mock("../../../../../packages/admin/src/lib/api/client", async () => {
	const actual = await vi.importActual("../../../../../packages/admin/src/lib/api/client");
	return {
		...actual,
		apiFetch: vi.fn().mockImplementation((url: string) => {
			if (url.includes("/setup/status")) {
				return Promise.resolve(
					new Response(
						JSON.stringify({
							data: {
								needsSetup: true,
								authMode: "passkey",
								...(mockSeedInfo ? { seedInfo: mockSeedInfo } : {}),
							},
						}),
						{
							status: 200,
						},
					),
				);
			}
			if (url.includes("/setup/admin")) {
				return Promise.resolve(
					new Response(JSON.stringify({ data: { success: true } }), { status: 200 }),
				);
			}
			if (url.includes("/setup") && !url.includes("status")) {
				return Promise.resolve(
					new Response(JSON.stringify({ data: { success: true } }), { status: 200 }),
				);
			}
			return Promise.resolve(new Response(JSON.stringify({ data: {} }), { status: 200 }));
		}),
	};
});

Object.defineProperty(window, "PublicKeyCredential", {
	value: function PublicKeyCredential() {},
	writable: true,
});

const { SetupWizard } = await import("../../../../../packages/admin/src/components/SetupWizard");

function QueryWrapper({ children }: { children: React.ReactNode }) {
	const qc = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("SetupWizard", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSeedInfo = null;
	});

	it("shows site setup step first with title input", async () => {
		const screen = await render(
			<QueryWrapper>
				<SetupWizard />
			</QueryWrapper>,
		);
		await expect.element(screen.getByText("Set up your site")).toBeInTheDocument();
		await expect.element(screen.getByPlaceholder("My Awesome Blog")).toBeInTheDocument();
	});

	it("empty title prevents advancing and shows validation error", async () => {
		const screen = await render(
			<QueryWrapper>
				<SetupWizard />
			</QueryWrapper>,
		);
		await expect.element(screen.getByText("Set up your site")).toBeInTheDocument();
		await screen.getByText("Continue →").click();
		await expect.element(screen.getByText("Site title is required")).toBeInTheDocument();
		await expect.element(screen.getByText("Set up your site")).toBeInTheDocument();
	});

	it("filling title and clicking Next advances to admin step", async () => {
		const screen = await render(
			<QueryWrapper>
				<SetupWizard />
			</QueryWrapper>,
		);
		await expect.element(screen.getByText("Set up your site")).toBeInTheDocument();
		await screen.getByPlaceholder("My Awesome Blog").fill("Test Site");
		await screen.getByText("Continue →").click();
		await expect.element(screen.getByText("Create your account")).toBeInTheDocument();
	});

	it("does not present media usage tracking as an onboarding choice", async () => {
		const screen = await render(
			<QueryWrapper>
				<SetupWizard />
			</QueryWrapper>,
		);
		await expect.element(screen.getByText("Set up your site")).toBeInTheDocument();
		expect(screen.getByRole("checkbox", { name: /Track where media is used/ }).query()).toBeNull();
	});

	it("admin step shows email input", async () => {
		const screen = await render(
			<QueryWrapper>
				<SetupWizard />
			</QueryWrapper>,
		);
		await expect.element(screen.getByText("Set up your site")).toBeInTheDocument();
		await screen.getByPlaceholder("My Awesome Blog").fill("Test Site");
		await screen.getByText("Continue →").click();
		await expect.element(screen.getByText("Create your account")).toBeInTheDocument();
		await expect.element(screen.getByPlaceholder("you@example.com")).toBeInTheDocument();
	});

	it("empty email prevents advancing on admin step", async () => {
		const screen = await render(
			<QueryWrapper>
				<SetupWizard />
			</QueryWrapper>,
		);
		await expect.element(screen.getByText("Set up your site")).toBeInTheDocument();
		await screen.getByPlaceholder("My Awesome Blog").fill("Test Site");
		await screen.getByText("Continue →").click();
		await expect.element(screen.getByText("Create your account")).toBeInTheDocument();
		await screen.getByText("Continue →").click();
		await expect.element(screen.getByText("Email is required")).toBeInTheDocument();
	});

	it("step indicator shows three steps", async () => {
		const screen = await render(
			<QueryWrapper>
				<SetupWizard />
			</QueryWrapper>,
		);
		await expect.element(screen.getByText("Set up your site")).toBeInTheDocument();
		await expect.element(screen.getByText("Account")).toBeInTheDocument();
		await expect.element(screen.getByText("Sign In")).toBeInTheDocument();
	});

	it("prefills title and tagline from seedInfo", async () => {
		mockSeedInfo = {
			name: "Blog Template",
			description: "A blog template",
			collections: 2,
			hasContent: true,
			title: "My Awesome Blog",
			tagline: "Thoughts and tutorials",
		};

		const screen = await render(
			<QueryWrapper>
				<SetupWizard />
			</QueryWrapper>,
		);

		await expect.element(screen.getByText("Set up your site")).toBeInTheDocument();

		const titleInput = screen.getByPlaceholder("My Awesome Blog");
		const taglineInput = screen.getByPlaceholder("Thoughts, tutorials, and more");

		await vi.waitFor(() => {
			expect((titleInput.element() as HTMLInputElement).value).toBe("My Awesome Blog");
		});
		await vi.waitFor(() => {
			expect((taglineInput.element() as HTMLInputElement).value).toBe("Thoughts and tutorials");
		});
	});

	it("uses empty string for title and tagline when not in seedInfo", async () => {
		mockSeedInfo = {
			name: "Blank Template",
			description: "A blank template",
			collections: 0,
			hasContent: false,
		};

		const screen = await render(
			<QueryWrapper>
				<SetupWizard />
			</QueryWrapper>,
		);

		await expect.element(screen.getByText("Set up your site")).toBeInTheDocument();

		const titleInput = screen.getByPlaceholder("My Awesome Blog");
		const taglineInput = screen.getByPlaceholder("Thoughts, tutorials, and more");

		await vi.waitFor(() => {
			expect((titleInput.element() as HTMLInputElement).value).toBe("");
		});
		await vi.waitFor(() => {
			expect((taglineInput.element() as HTMLInputElement).value).toBe("");
		});
	});

	it("prefilled title can be edited and submitted", async () => {
		mockSeedInfo = {
			name: "Blog Template",
			description: "A blog template",
			collections: 2,
			hasContent: true,
			title: "My Awesome Blog",
			tagline: "Thoughts and tutorials",
		};

		const screen = await render(
			<QueryWrapper>
				<SetupWizard />
			</QueryWrapper>,
		);

		await expect.element(screen.getByText("Set up your site")).toBeInTheDocument();

		const titleInput = screen.getByPlaceholder("My Awesome Blog");
		await vi.waitFor(() => {
			expect((titleInput.element() as HTMLInputElement).value).toBe("My Awesome Blog");
		});

		await titleInput.fill("My Custom Blog");
		await vi.waitFor(() => {
			expect((screen.getByPlaceholder("My Awesome Blog").element() as HTMLInputElement).value).toBe(
				"My Custom Blog",
			);
		});

		await screen.getByText("Continue →").click();
		await expect.element(screen.getByText("Create your account")).toBeInTheDocument();
	});
});
