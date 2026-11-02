import { Toast } from "@cloudflare/kumo";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { BylineFieldEditor } from "../../../../../packages/admin/src/components/BylineFieldEditor";
import type { BylineFieldDefinition } from "../../../../../packages/admin/src/lib/api/byline-fields";
import { render } from "../utils/render.tsx";

vi.mock("../../../../../packages/admin/src/lib/api/current-user", () => ({
	useCurrentUser: vi.fn(),
}));

const { useCurrentUser } = await import("../../../../../packages/admin/src/lib/api/current-user");

vi.mock("../../../../../packages/admin/src/lib/api/byline-fields", async () => {
	const actual = await vi.importActual<
		typeof import("../../../../../packages/admin/src/lib/api/byline-fields")
	>("../../../../../packages/admin/src/lib/api/byline-fields");
	return {
		...actual,
		listBylineFields: vi.fn(),
		getBylineFieldUsage: vi.fn(),
		createBylineField: vi.fn(),
		updateBylineField: vi.fn(),
		deleteBylineField: vi.fn(),
		reorderBylineFields: vi.fn(),
	};
});

const { listBylineFields } =
	await import("../../../../../packages/admin/src/lib/api/byline-fields");
const { BylineSchemaPage } = await import("../../../../../packages/admin/src/routes/byline-schema");

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

const defaultProps = {
	open: true,
	onOpenChange: vi.fn(),
	onSave: vi.fn(),
};

beforeEach(() => {
	vi.clearAllMocks();
});

function PageWrapper({ children }: { children: React.ReactNode }) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	return (
		<QueryClientProvider client={queryClient}>
			<Toast.Provider>{children}</Toast.Provider>
		</QueryClientProvider>
	);
}

const ROLE_EDITOR = 40;
const ROLE_ADMIN = 50;

describe("BylineSchemaPage — permission gate", () => {
	it("renders Access denied for an EDITOR (below schema:manage)", async () => {
		vi.mocked(useCurrentUser).mockReturnValue({
			data: { id: "u1", email: "e@e", role: ROLE_EDITOR },
			isLoading: false,
			// eslint-disable-next-line typescript/no-explicit-any -- mock object satisfies the consumed shape; the rest is unused
		} as any);

		const screen = await render(
			<PageWrapper>
				<BylineSchemaPage />
			</PageWrapper>,
		);

		await expect.element(screen.getByText("Access denied")).toBeInTheDocument();
		expect(screen.getByRole("heading", { name: "Byline schema" }).query()).toBeNull();
		expect(screen.getByRole("button", { name: "New field" }).query()).toBeNull();
		expect(vi.mocked(listBylineFields)).not.toHaveBeenCalled();
	});

	it("renders the schema management UI for an ADMIN", async () => {
		vi.mocked(useCurrentUser).mockReturnValue({
			data: { id: "u1", email: "a@a", role: ROLE_ADMIN },
			isLoading: false,
			// eslint-disable-next-line typescript/no-explicit-any -- mock object satisfies the consumed shape
		} as any);
		vi.mocked(listBylineFields).mockResolvedValue({ items: [] });

		const screen = await render(
			<PageWrapper>
				<BylineSchemaPage />
			</PageWrapper>,
		);

		await expect
			.element(screen.getByRole("heading", { name: "Byline schema" }))
			.toBeInTheDocument();
		await expect.element(screen.getByRole("button", { name: "New field" })).toBeInTheDocument();
		expect(screen.getByText("Access denied").query()).toBeNull();
	});
});

describe("BylineFieldEditor", () => {
	describe("create mode", () => {
		it("renders the create-mode title", async () => {
			const screen = await render(<BylineFieldEditor {...defaultProps} />);
			await expect.element(screen.getByText("New byline field")).toBeInTheDocument();
		});

		it("shows the create-mode primary button label", async () => {
			const screen = await render(<BylineFieldEditor {...defaultProps} />);
			await expect
				.element(screen.getByRole("button", { name: "Create field" }))
				.toBeInTheDocument();
		});

		it("renders the label and slug inputs as enabled", async () => {
			const screen = await render(<BylineFieldEditor {...defaultProps} />);
			const slug = screen.getByLabelText("Slug");
			await expect.element(slug).toBeInTheDocument();
			await expect.element(slug).not.toBeDisabled();
		});

		it("renders the required + translatable switches", async () => {
			const screen = await render(<BylineFieldEditor {...defaultProps} />);
			await expect.element(screen.getByText("Required")).toBeInTheDocument();
			await expect.element(screen.getByText("Translatable")).toBeInTheDocument();
		});

		it("does not render the select-options textarea for the default string type", async () => {
			const screen = await render(<BylineFieldEditor {...defaultProps} />);
			expect(screen.getByLabelText("Options (one per line)").query()).toBeNull();
		});
	});

	describe("edit mode (string field)", () => {
		const stringField = makeField({ type: "string", label: "Job title", slug: "job_title" });

		it("renders the edit-mode title", async () => {
			const screen = await render(<BylineFieldEditor {...defaultProps} field={stringField} />);
			await expect.element(screen.getByText("Edit byline field")).toBeInTheDocument();
		});

		it("shows the edit-mode primary button label", async () => {
			const screen = await render(<BylineFieldEditor {...defaultProps} field={stringField} />);
			await expect
				.element(screen.getByRole("button", { name: "Save changes" }))
				.toBeInTheDocument();
		});

		it("disables the slug input — slugs are immutable post-create", async () => {
			const screen = await render(<BylineFieldEditor {...defaultProps} field={stringField} />);
			await expect.element(screen.getByLabelText("Slug")).toBeDisabled();
		});

		it("prefills the label and slug from the field prop", async () => {
			const screen = await render(<BylineFieldEditor {...defaultProps} field={stringField} />);
			await expect.element(screen.getByLabelText("Label")).toHaveValue("Job title");
			await expect.element(screen.getByLabelText("Slug")).toHaveValue("job_title");
		});

		it("does not render the select-options textarea", async () => {
			const screen = await render(<BylineFieldEditor {...defaultProps} field={stringField} />);
			expect(screen.getByLabelText("Options (one per line)").query()).toBeNull();
		});
	});

	describe("edit mode (select field)", () => {
		const selectField = makeField({
			type: "select",
			label: "Role",
			slug: "role",
			validation: { options: ["Editor", "Reporter", "Photographer"] },
		});

		it("renders the options textarea for select-type fields", async () => {
			const screen = await render(<BylineFieldEditor {...defaultProps} field={selectField} />);
			await expect.element(screen.getByLabelText("Options (one per line)")).toBeInTheDocument();
		});

		it("prefills the options textarea from validation.options", async () => {
			const screen = await render(<BylineFieldEditor {...defaultProps} field={selectField} />);
			await expect
				.element(screen.getByLabelText("Options (one per line)"))
				.toHaveValue("Editor\nReporter\nPhotographer");
		});
	});

	describe("translatable toggle (AC: round-trips through the API)", () => {
		it("reflects a translatable=true field as a checked switch", async () => {
			const field = makeField({ translatable: true });
			const screen = await render(<BylineFieldEditor {...defaultProps} field={field} />);
			const sw = screen.getByRole("switch", { name: "Translatable" });
			await expect.element(sw).toBeChecked();
		});

		it("reflects a translatable=false field as an unchecked switch", async () => {
			const field = makeField({ translatable: false });
			const screen = await render(<BylineFieldEditor {...defaultProps} field={field} />);
			const sw = screen.getByRole("switch", { name: "Translatable" });
			await expect.element(sw).not.toBeChecked();
		});

		it("locks the translatable switch when usageTotal > 0", async () => {
			const field = makeField({ translatable: true });
			const screen = await render(
				<BylineFieldEditor {...defaultProps} field={field} usageTotal={5} />,
			);
			const sw = screen.getByRole("switch", { name: "Translatable" });
			await expect.element(sw).toBeDisabled();
			await expect
				.element(screen.getByText(/Locked because this field has stored values/))
				.toBeInTheDocument();
		});

		it("leaves the translatable switch enabled when usageTotal is 0", async () => {
			const field = makeField({ translatable: true });
			const screen = await render(
				<BylineFieldEditor {...defaultProps} field={field} usageTotal={0} />,
			);
			const sw = screen.getByRole("switch", { name: "Translatable" });
			await expect.element(sw).not.toBeDisabled();
		});
	});
});
