import { Toast } from "@cloudflare/kumo";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import type { BylineFieldDefinition } from "../../../../packages/admin/src/lib/api/byline-fields";
import type { BylineSummary } from "../../../../packages/admin/src/lib/api/bylines";
import { render } from "./utils/render.tsx";

vi.mock("@tanstack/react-router", async () => {
	const actual =
		await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
	return {
		...actual,
		useSearch: () => ({ locale: undefined }),
		useNavigate: () => vi.fn(),
	};
});

vi.mock("../../../../packages/admin/src/lib/api/bylines", async () => {
	const actual = await vi.importActual<
		typeof import("../../../../packages/admin/src/lib/api/bylines")
	>("../../../../packages/admin/src/lib/api/bylines");
	return {
		...actual,
		fetchBylines: vi.fn(),
		fetchByline: vi.fn(),
		fetchBylineTranslations: vi.fn().mockResolvedValue({ items: [] }),
		createByline: vi.fn(),
		updateByline: vi.fn(),
		deleteByline: vi.fn(),
		createBylineTranslation: vi.fn(),
	};
});

vi.mock("../../../../packages/admin/src/lib/api/users", async () => {
	const actual = await vi.importActual<
		typeof import("../../../../packages/admin/src/lib/api/users")
	>("../../../../packages/admin/src/lib/api/users");
	return {
		...actual,
		fetchUsers: vi.fn().mockResolvedValue({ items: [], nextCursor: undefined }),
	};
});

vi.mock("../../../../packages/admin/src/lib/api/byline-fields", async () => {
	const actual = await vi.importActual<
		typeof import("../../../../packages/admin/src/lib/api/byline-fields")
	>("../../../../packages/admin/src/lib/api/byline-fields");
	return {
		...actual,
		listBylineFields: vi.fn(),
	};
});

vi.mock("../../../../packages/admin/src/lib/api/client", async () => {
	const actual = await vi.importActual<
		typeof import("../../../../packages/admin/src/lib/api/client")
	>("../../../../packages/admin/src/lib/api/client");
	return {
		...actual,
		fetchManifest: vi.fn().mockResolvedValue({
			version: "0.0.0",
			hash: "test",
			collections: {},
			plugins: {},
			authMode: "passkey",
			taxonomies: [],
		}),
	};
});

const { fetchBylines, fetchByline, updateByline } =
	await import("../../../../packages/admin/src/lib/api/bylines");
const { listBylineFields } = await import("../../../../packages/admin/src/lib/api/byline-fields");
const { BylinesPage } = await import("../../../../packages/admin/src/routes/bylines");

function makeByline(overrides: Partial<BylineSummary> = {}): BylineSummary {
	return {
		id: "byline_01",
		slug: "jane-doe",
		displayName: "Jane Doe",
		bio: null,
		avatarMediaId: null,
		websiteUrl: null,
		userId: null,
		isGuest: true,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		locale: "en",
		translationGroup: null,
		customFields: {},
		...overrides,
	};
}

function makeField(overrides: Partial<BylineFieldDefinition> = {}): BylineFieldDefinition {
	return {
		id: "fld_01",
		slug: "job_title",
		label: "Job title",
		type: "string",
		required: false,
		translatable: true,
		validation: null,
		sortOrder: 0,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		...overrides,
	};
}

function TestWrapper({ children }: { children: React.ReactNode }) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	return (
		<QueryClientProvider client={queryClient}>
			<Toast.Provider>{children}</Toast.Provider>
		</QueryClientProvider>
	);
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("BylinesPage — custom-field inputs (Phase 6 of #1174)", () => {
	it("renders the custom-field input after selecting a byline", async () => {
		const byline = makeByline();
		vi.mocked(fetchBylines).mockResolvedValue({ items: [byline], nextCursor: undefined });
		vi.mocked(fetchByline).mockResolvedValue(byline);
		vi.mocked(listBylineFields).mockResolvedValue({
			items: [makeField({ label: "Job title", slug: "job_title", type: "string" })],
		});

		const screen = await render(
			<TestWrapper>
				<BylinesPage />
			</TestWrapper>,
		);

		const bylineButton = screen.getByRole("button", { name: /Jane Doe/ });
		await bylineButton.click();

		await expect.element(screen.getByLabelText("Job title")).toBeInTheDocument();
	});

	it("renders the custom-field input in create mode", async () => {
		vi.mocked(fetchBylines).mockResolvedValue({ items: [], nextCursor: undefined });
		vi.mocked(listBylineFields).mockResolvedValue({
			items: [makeField({ label: "Job title", slug: "job_title", type: "string" })],
		});

		const screen = await render(
			<TestWrapper>
				<BylinesPage />
			</TestWrapper>,
		);

		await expect.element(screen.getByText("Create byline")).toBeInTheDocument();
		await expect.element(screen.getByLabelText("Job title")).toBeInTheDocument();
	});

	it("forwards customFields in the PATCH body on save", async () => {
		const byline = makeByline({
			customFields: { job_title: "Senior editor" },
		});
		vi.mocked(fetchBylines).mockResolvedValue({ items: [byline], nextCursor: undefined });
		vi.mocked(fetchByline).mockResolvedValue(byline);
		vi.mocked(listBylineFields).mockResolvedValue({
			items: [makeField({ slug: "job_title", type: "string" })],
		});
		vi.mocked(updateByline).mockResolvedValue(byline);

		const screen = await render(
			<TestWrapper>
				<BylinesPage />
			</TestWrapper>,
		);

		await screen.getByRole("button", { name: /Jane Doe/ }).click();

		const input = screen.getByLabelText("Job title");
		await expect.element(input).toHaveValue("Senior editor");

		await screen.getByRole("button", { name: "Save" }).click();

		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(vi.mocked(updateByline)).toHaveBeenCalledTimes(1);
		const [bylineId, body] = vi.mocked(updateByline).mock.calls[0]!;
		expect(bylineId).toBe(byline.id);
		expect(body.customFields).toEqual({ job_title: "Senior editor" });
	});

	it("omits customFields from the PATCH body when field-defs fail to load", async () => {
		const byline = makeByline({
			customFields: { job_title: "Senior editor" },
		});
		vi.mocked(fetchBylines).mockResolvedValue({ items: [byline], nextCursor: undefined });
		vi.mocked(fetchByline).mockResolvedValue(byline);
		vi.mocked(listBylineFields).mockRejectedValue(new Error("network blip"));
		vi.mocked(updateByline).mockResolvedValue(byline);

		const screen = await render(
			<TestWrapper>
				<BylinesPage />
			</TestWrapper>,
		);

		await screen.getByRole("button", { name: /Jane Doe/ }).click();

		await expect.element(screen.getByText("Couldn't load custom fields.")).toBeInTheDocument();

		await screen.getByRole("button", { name: "Save" }).click();
		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(vi.mocked(updateByline)).toHaveBeenCalledTimes(1);
		const [, body] = vi.mocked(updateByline).mock.calls[0]!;
		expect(body).not.toHaveProperty("customFields");
		expect(body.slug).toBe(byline.slug);
		expect(body.displayName).toBe(byline.displayName);
	});

	it("renders the right Kumo input for each registered field type", async () => {
		const byline = makeByline({
			customFields: {
				job_title: "Editor",
				bio_long: "A long bio.",
				homepage: "https://example.com",
				is_staff: true,
				tier: "gold",
			},
		});
		vi.mocked(fetchBylines).mockResolvedValue({ items: [byline], nextCursor: undefined });
		vi.mocked(fetchByline).mockResolvedValue(byline);
		vi.mocked(listBylineFields).mockResolvedValue({
			items: [
				makeField({ id: "f1", slug: "job_title", label: "Job title", type: "string" }),
				makeField({ id: "f2", slug: "bio_long", label: "Long bio", type: "text" }),
				makeField({ id: "f3", slug: "homepage", label: "Homepage", type: "url" }),
				makeField({ id: "f4", slug: "is_staff", label: "Staff", type: "boolean" }),
				makeField({
					id: "f5",
					slug: "tier",
					label: "Tier",
					type: "select",
					validation: { options: ["bronze", "silver", "gold"] },
				}),
			],
		});

		const screen = await render(
			<TestWrapper>
				<BylinesPage />
			</TestWrapper>,
		);

		await screen.getByRole("button", { name: /Jane Doe/ }).click();

		await expect.element(screen.getByLabelText("Job title")).toBeInTheDocument();
		await expect.element(screen.getByLabelText("Long bio")).toBeInTheDocument();
		await expect.element(screen.getByLabelText("Homepage")).toBeInTheDocument();
		await expect.element(screen.getByRole("switch", { name: "Staff" })).toBeInTheDocument();
		await expect.element(screen.getByText("Tier")).toBeInTheDocument();
	});
});
