import { Toasty } from "@cloudflare/kumo";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { userEvent } from "vitest/browser";

import {
	getAvailableParentTerms,
	replaceSiblingGroup,
	reorderWithinSlots,
	TaxonomyManager,
} from "../../../../../packages/admin/src/components/TaxonomyManager";
import type { TaxonomyTerm } from "../../../../../packages/admin/src/lib/api/taxonomies.js";
import { render } from "../utils/render.tsx";

const taxonomyResponse = JSON.stringify({
	data: {
		taxonomies: [
			{
				id: "t1",
				name: "categories",
				label: "Categories",
				labelSingular: "Category",
				hierarchical: true,
				collections: ["posts"],
			},
		],
	},
});

const termsResponse = JSON.stringify({
	data: {
		terms: [
			{
				id: "1",
				name: "tech",
				slug: "tech",
				label: "Technology",
				parentId: null,
				children: [],
				count: 5,
			},
			{
				id: "2",
				name: "science",
				slug: "science",
				label: "Science",
				parentId: null,
				children: [],
				count: 3,
			},
		],
	},
});

const hierarchicalTermsResponse = JSON.stringify({
	data: {
		terms: [
			{
				id: "design",
				name: "design",
				slug: "design",
				label: "Design",
				parentId: null,
				translationGroup: "design-group",
				children: [
					{
						id: "test",
						name: "test",
						slug: "test",
						label: "Test",
						parentId: "design-group",
						translationGroup: "test-group",
						children: [
							{
								id: "test-child",
								name: "test-child",
								slug: "test-child",
								label: "Test child",
								parentId: "test-group",
								translationGroup: "test-child-group",
								children: [],
								count: 0,
							},
						],
						count: 0,
					},
				],
				count: 1,
			},
			{
				id: "development",
				name: "development",
				slug: "development",
				label: "Development",
				parentId: null,
				translationGroup: "development-group",
				children: [],
				count: 4,
			},
		],
	},
});

const nestedSiblingsTermsResponse = JSON.stringify({
	data: {
		terms: [
			{
				id: "design",
				name: "design",
				slug: "design",
				label: "Design",
				parentId: null,
				translationGroup: "design-group",
				children: [
					{
						id: "fonts",
						name: "fonts",
						slug: "fonts",
						label: "Fonts",
						parentId: "design-group",
						translationGroup: "fonts-group",
						children: [],
						count: 0,
					},
					{
						id: "colour",
						name: "colour",
						slug: "colour",
						label: "Colour",
						parentId: "design-group",
						translationGroup: "colour-group",
						children: [],
						count: 0,
					},
				],
				count: 1,
			},
			{
				id: "development",
				name: "development",
				slug: "development",
				label: "Development",
				parentId: null,
				translationGroup: "development-group",
				children: [],
				count: 4,
			},
		],
	},
});

const untranslatedParentTermsResponse = JSON.stringify({
	data: {
		terms: [
			{
				id: "beta",
				name: "beta",
				slug: "beta",
				label: "Beta",
				parentId: null,
				translationGroup: "beta-group",
				children: [],
				count: 0,
			},
			{
				id: "nino",
				name: "nino",
				slug: "nino",
				label: "Nino",
				parentId: "alpha-group",
				translationGroup: "nino-group",
				children: [],
				count: 0,
			},
			{
				id: "gamma",
				name: "gamma",
				slug: "gamma",
				label: "Gamma",
				parentId: null,
				translationGroup: "gamma-group",
				children: [],
				count: 0,
			},
		],
	},
});

vi.mock("../../../../../packages/admin/src/lib/api/client.js", async () => {
	const actual = await vi.importActual("../../../../../packages/admin/src/lib/api/client.js");
	return {
		...actual,
		apiFetch: vi.fn(),
	};
});

import { apiFetch } from "../../../../../packages/admin/src/lib/api/client.js";

function deferReorders() {
	const pending: Array<() => void> = [];
	let open = false;
	const ok = () =>
		new Response(JSON.stringify({ data: { reordered: true } }), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	return {
		hold: (): Promise<Response> => {
			if (open) return Promise.resolve(ok());
			return new Promise((resolve) => pending.push(() => resolve(ok())));
		},
		release: () => {
			open = true;
			for (const settle of pending.splice(0)) settle();
		},
		get inFlight() {
			return pending.length;
		},
	};
}

function mockApiFetch(overrideTerms?: string, defer?: ReturnType<typeof deferReorders>) {
	vi.mocked(apiFetch).mockImplementation((url: string, init?: RequestInit) => {
		const urlStr = typeof url === "string" ? url : "";
		if (defer && urlStr.includes("/reorder")) return defer.hold();
		if (urlStr.includes("/terms") && (!init || !init.method || init.method === "GET")) {
			return Promise.resolve(
				new Response(overrideTerms ?? termsResponse, {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
			);
		}
		if (urlStr.includes("/taxonomies") && (!init || !init.method || init.method === "GET")) {
			return Promise.resolve(
				new Response(taxonomyResponse, {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
			);
		}
		return Promise.resolve(
			new Response(JSON.stringify({ data: { success: true } }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}),
		);
	});
}

function Wrapper({ children }: { children: React.ReactNode }) {
	const qc = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	return (
		<Toasty>
			<QueryClientProvider client={qc}>{children}</QueryClientProvider>
		</Toasty>
	);
}

const ADD_CATEGORY_BUTTON_REGEX = /Add Category/;
const ADD_CATEGORY_HEADING_REGEX = /Add Category/;
const EDIT_CATEGORY_HEADING_REGEX = /Edit Category/;
const PARENT_SELECTOR_REGEX = /Parent/;
const NO_CATEGORIES_REGEX = /No categories yet/;
const DELETE_CATEGORY_HEADING_REGEX = /Delete Category/i;
const DELETE_TECHNOLOGY_DESC_REGEX = /permanently delete "Technology"/;

describe("TaxonomyManager", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockApiFetch();
	});

	it("displays taxonomy name as heading", async () => {
		const screen = await render(<TaxonomyManager taxonomyName="categories" />, {
			wrapper: Wrapper,
		});

		await expect.element(screen.getByRole("heading", { name: "Categories" })).toBeInTheDocument();
	});

	it("shows list of terms with labels", async () => {
		const screen = await render(<TaxonomyManager taxonomyName="categories" />, {
			wrapper: Wrapper,
		});

		await expect.element(screen.getByText("Technology", { exact: true })).toBeInTheDocument();
		await expect.element(screen.getByText("(science)")).toBeInTheDocument();
	});

	it("shows term slugs in parentheses", async () => {
		const screen = await render(<TaxonomyManager taxonomyName="categories" />, {
			wrapper: Wrapper,
		});

		await expect.element(screen.getByText("(tech)")).toBeInTheDocument();
		await expect.element(screen.getByText("(science)")).toBeInTheDocument();
	});

	it("add button opens create dialog", async () => {
		const screen = await render(<TaxonomyManager taxonomyName="categories" />, {
			wrapper: Wrapper,
		});

		await expect.element(screen.getByRole("heading", { name: "Categories" })).toBeInTheDocument();

		await screen.getByRole("button", { name: ADD_CATEGORY_BUTTON_REGEX }).click();

		await expect
			.element(screen.getByRole("heading", { name: ADD_CATEGORY_HEADING_REGEX }))
			.toBeInTheDocument();
	});

	it("create dialog has name, slug, and description inputs", async () => {
		const screen = await render(<TaxonomyManager taxonomyName="categories" />, {
			wrapper: Wrapper,
		});

		await expect.element(screen.getByRole("heading", { name: "Categories" })).toBeInTheDocument();

		await screen.getByRole("button", { name: ADD_CATEGORY_BUTTON_REGEX }).click();

		await expect.element(screen.getByLabelText("Name")).toBeInTheDocument();
		await expect.element(screen.getByLabelText("Slug")).toBeInTheDocument();
		await expect.element(screen.getByText("Description (optional)")).toBeInTheDocument();
	});

	it("lets the server derive an auto-generated term slug", async () => {
		const screen = await render(<TaxonomyManager taxonomyName="categories" />, {
			wrapper: Wrapper,
		});
		await screen.getByRole("button", { name: ADD_CATEGORY_BUTTON_REGEX }).click();
		await screen.getByLabelText("Name").fill("音楽");
		await expect.element(screen.getByLabelText("Slug")).toHaveValue("音楽");

		await userEvent.keyboard("{Enter}");

		await vi.waitFor(() => {
			const call = vi.mocked(apiFetch).mock.calls.find(([, init]) => init?.method === "POST");
			expect(call).toBeDefined();
			const body = typeof call?.[1]?.body === "string" ? JSON.parse(call[1].body) : undefined;
			expect(body).toMatchObject({ label: "音楽" });
			expect(body).not.toHaveProperty("slug");
		});
	});

	it("sends a manually edited term slug", async () => {
		const screen = await render(<TaxonomyManager taxonomyName="categories" />, {
			wrapper: Wrapper,
		});
		await screen.getByRole("button", { name: ADD_CATEGORY_BUTTON_REGEX }).click();
		await screen.getByLabelText("Name").fill("Music");
		await screen.getByLabelText("Slug").fill("custom-music");

		await userEvent.keyboard("{Enter}");

		await vi.waitFor(() => {
			const call = vi.mocked(apiFetch).mock.calls.find(([, init]) => init?.method === "POST");
			const body = typeof call?.[1]?.body === "string" ? JSON.parse(call[1].body) : undefined;
			expect(body).toMatchObject({ label: "Music", slug: "custom-music" });
		});
	});

	it("shows parent selector for hierarchical taxonomies", async () => {
		const screen = await render(<TaxonomyManager taxonomyName="categories" />, {
			wrapper: Wrapper,
		});

		await expect.element(screen.getByRole("heading", { name: "Categories" })).toBeInTheDocument();

		await screen.getByRole("button", { name: ADD_CATEGORY_BUTTON_REGEX }).click();

		await expect.element(screen.getByLabelText(PARENT_SELECTOR_REGEX)).toBeInTheDocument();
	});

	it("lists each nested term once in the parent selector", () => {
		const terms = JSON.parse(hierarchicalTermsResponse).data.terms;
		const labels = getAvailableParentTerms(terms).map((term) => term.label);

		expect(labels).toEqual(["Design", "Test", "Test child", "Development"]);
	});

	it("excludes the edited term and all descendants from parent choices", () => {
		const terms = JSON.parse(hierarchicalTermsResponse).data.terms;
		const labels = getAvailableParentTerms(terms, terms[0]).map((term) => term.label);

		expect(labels).toEqual(["Development"]);
	});

	it("selects the current parent by translation group when editing a nested term", async () => {
		mockApiFetch(hierarchicalTermsResponse);
		const screen = await render(<TaxonomyManager taxonomyName="categories" />, {
			wrapper: Wrapper,
		});

		await expect.element(screen.getByText("Test", { exact: true })).toBeInTheDocument();
		await screen.getByRole("button", { name: "Edit Test", exact: true }).click();

		await expect.element(screen.getByLabelText(PARENT_SELECTOR_REGEX)).toHaveTextContent("Design");
	});

	it("edit button opens dialog", async () => {
		const screen = await render(<TaxonomyManager taxonomyName="categories" />, {
			wrapper: Wrapper,
		});

		await expect.element(screen.getByText("Technology", { exact: true })).toBeInTheDocument();

		await screen.getByRole("button", { name: "Edit Technology" }).click();

		await expect
			.element(screen.getByRole("heading", { name: EDIT_CATEGORY_HEADING_REGEX }))
			.toBeInTheDocument();
	});

	it("delete button opens confirm dialog", async () => {
		const screen = await render(<TaxonomyManager taxonomyName="categories" />, {
			wrapper: Wrapper,
		});

		await expect.element(screen.getByText("Technology", { exact: true })).toBeInTheDocument();

		await screen.getByRole("button", { name: "Delete Technology" }).click();

		await expect
			.element(screen.getByRole("heading", { name: DELETE_CATEGORY_HEADING_REGEX }))
			.toBeInTheDocument();
		await expect.element(screen.getByText(DELETE_TECHNOLOGY_DESC_REGEX)).toBeInTheDocument();
		await expect.element(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
		await expect.element(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
	});

	function reorderRequestBody(): unknown {
		const call = vi
			.mocked(apiFetch)
			.mock.calls.find(([url]) => typeof url === "string" && url.includes("/reorder"));
		const body = call?.[1]?.body;
		return typeof body === "string" ? JSON.parse(body) : undefined;
	}

	function reorderRequestBodies(): unknown[] {
		return vi
			.mocked(apiFetch)
			.mock.calls.filter(([url]) => typeof url === "string" && url.includes("/reorder"))
			.map(([, init]) => (typeof init?.body === "string" ? JSON.parse(init.body) : undefined));
	}

	function termFetchCount(): number {
		return vi
			.mocked(apiFetch)
			.mock.calls.filter(
				([url, init]) =>
					typeof url === "string" &&
					url.includes("/terms") &&
					!url.includes("/reorder") &&
					(!init || !init.method || init.method === "GET"),
			).length;
	}

	function renderedOrder(): string[] {
		const buttons = document.querySelectorAll<HTMLElement>('button[aria-label$=" up"]');
		return Array.from(buttons, (button) =>
			(button.getAttribute("aria-label") ?? "").slice("Move ".length, -" up".length),
		);
	}

	it("moving a term sends the whole sibling group in its new order", async () => {
		const screen = await render(<TaxonomyManager taxonomyName="categories" />, {
			wrapper: Wrapper,
		});

		await expect.element(screen.getByText("Technology", { exact: true })).toBeInTheDocument();

		await screen.getByRole("button", { name: "Move Technology down" }).click();

		expect(reorderRequestBody()).toEqual({ parentId: null, ids: ["2", "1"] });
	});

	it("moves the row on screen before the request comes back", async () => {
		const defer = deferReorders();
		mockApiFetch(undefined, defer);
		const screen = await render(<TaxonomyManager taxonomyName="categories" />, {
			wrapper: Wrapper,
		});

		await expect.element(screen.getByText("Technology", { exact: true })).toBeInTheDocument();
		expect(renderedOrder()).toEqual(["Technology", "Science"]);

		await screen.getByRole("button", { name: "Move Technology down" }).click();

		expect(defer.inFlight).toBe(1);
		expect(renderedOrder()).toEqual(["Science", "Technology"]);

		defer.release();
	});

	it("queues rapid moves and refetches once at the end", async () => {
		const defer = deferReorders();
		mockApiFetch(undefined, defer);
		const screen = await render(<TaxonomyManager taxonomyName="categories" />, {
			wrapper: Wrapper,
		});

		await expect.element(screen.getByText("Technology", { exact: true })).toBeInTheDocument();
		const fetchesBefore = termFetchCount();

		await screen.getByRole("button", { name: "Move Technology down" }).click();
		expect(renderedOrder()).toEqual(["Science", "Technology"]);
		await screen.getByRole("button", { name: "Move Technology up" }).click();
		expect(renderedOrder()).toEqual(["Technology", "Science"]);

		defer.release();
		await vi.waitFor(() => expect(reorderRequestBodies()).toHaveLength(2));

		expect(reorderRequestBodies()).toEqual([
			{ parentId: null, ids: ["2", "1"] },
			{ parentId: null, ids: ["1", "2"] },
		]);

		expect(termFetchCount()).toBe(fetchesBefore + 1);
	});

	it("cannot move the first term up or the last term down", async () => {
		const screen = await render(<TaxonomyManager taxonomyName="categories" />, {
			wrapper: Wrapper,
		});

		await expect.element(screen.getByText("Technology", { exact: true })).toBeInTheDocument();

		await expect.element(screen.getByRole("button", { name: "Move Technology up" })).toBeDisabled();
		await expect.element(screen.getByRole("button", { name: "Move Science down" })).toBeDisabled();
		await expect
			.element(screen.getByRole("button", { name: "Move Technology down" }))
			.toBeEnabled();
	});

	it("reorders the top level while nested rows are on screen", async () => {
		mockApiFetch(hierarchicalTermsResponse);
		const screen = await render(<TaxonomyManager taxonomyName="categories" />, {
			wrapper: Wrapper,
		});

		await expect.element(screen.getByText("Test", { exact: true })).toBeInTheDocument();

		await screen.getByRole("button", { name: "Move Design down" }).click();

		expect(reorderRequestBody()).toEqual({
			parentId: null,
			ids: ["development-group", "design-group"],
		});
	});

	it("reorders a nested group under its own parent, leaving the roots alone", async () => {
		mockApiFetch(nestedSiblingsTermsResponse);
		const screen = await render(<TaxonomyManager taxonomyName="categories" />, {
			wrapper: Wrapper,
		});

		await expect.element(screen.getByText("Fonts", { exact: true })).toBeInTheDocument();

		await screen.getByRole("button", { name: "Move Fonts down" }).click();

		expect(reorderRequestBody()).toEqual({
			parentId: "design-group",
			ids: ["colour-group", "fonts-group"],
		});
	});

	it("cannot move a term whose parent is untranslated", async () => {
		mockApiFetch(untranslatedParentTermsResponse);
		const screen = await render(<TaxonomyManager taxonomyName="categories" />, {
			wrapper: Wrapper,
		});

		await expect.element(screen.getByText("Nino", { exact: true })).toBeInTheDocument();

		const up = screen.getByRole("button", {
			name: "Move Nino up — unavailable, its parent has no translation in this locale",
		});
		const down = screen.getByRole("button", {
			name: "Move Nino down — unavailable, its parent has no translation in this locale",
		});
		await expect.element(up).toBeDisabled();
		await expect.element(down).toBeDisabled();
	});

	it("leaves an untranslated-parent term out of the group it is drawn in", async () => {
		mockApiFetch(untranslatedParentTermsResponse);
		const screen = await render(<TaxonomyManager taxonomyName="categories" />, {
			wrapper: Wrapper,
		});

		await expect.element(screen.getByText("Gamma", { exact: true })).toBeInTheDocument();

		await screen.getByRole("button", { name: "Move Beta down" }).click();

		expect(reorderRequestBody()).toEqual({
			parentId: null,
			ids: ["gamma-group", "beta-group"],
		});
	});

	it("splices a reordered child group into its parent, leaving the roots alone", () => {
		const terms: TaxonomyTerm[] = JSON.parse(nestedSiblingsTermsResponse).data.terms;
		const [fonts, colour] = terms[0]!.children;

		const next = replaceSiblingGroup(terms, "design-group", [colour!, fonts!]);

		expect(next.map((term) => term.label)).toEqual(["Design", "Development"]);
		expect(next[0]!.children.map((term) => term.label)).toEqual(["Colour", "Fonts"]);
	});

	it("permutes movable terms within their slots, leaving the rest in place", () => {
		const terms: TaxonomyTerm[] = JSON.parse(untranslatedParentTermsResponse).data.terms;
		const [beta, nino, gamma] = terms;
		const movable = [beta!, gamma!];

		const next = reorderWithinSlots(terms, movable, [gamma!, beta!]);

		expect(next.map((term) => term.label)).toEqual(["Gamma", "Nino", "Beta"]);
		expect(next[1]).toBe(nino);
	});

	it("replaces the root list when ordering the top level", () => {
		const terms: TaxonomyTerm[] = JSON.parse(nestedSiblingsTermsResponse).data.terms;

		const next = replaceSiblingGroup(terms, null, [terms[1]!, terms[0]!]);

		expect(next.map((term) => term.label)).toEqual(["Development", "Design"]);
	});

	it("shows empty state when no terms", async () => {
		mockApiFetch(JSON.stringify({ data: { terms: [] } }));

		const screen = await render(<TaxonomyManager taxonomyName="categories" />, {
			wrapper: Wrapper,
		});

		await expect.element(screen.getByText(NO_CATEGORIES_REGEX)).toBeInTheDocument();
	});
});
