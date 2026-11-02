import { Toasty } from "@cloudflare/kumo";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import type { AdminManifest, Section } from "../../../../../packages/admin/src/lib/api";
import { render } from "../utils/render.tsx";

const portableTextProps: { current: Record<string, unknown> | null } = { current: null };

vi.mock("../../../../../packages/admin/src/components/PortableTextEditor", () => ({
	PortableTextEditor: (props: Record<string, unknown>) => {
		portableTextProps.current = props;
		return <div data-testid="portable-text-editor" />;
	},
}));

vi.mock("../../../../../packages/admin/src/components/MediaPickerModal", () => ({
	MediaPickerModal: () => null,
}));

vi.mock("@tanstack/react-router", async () => {
	const actual = await vi.importActual("@tanstack/react-router");
	return {
		...(actual as Record<string, unknown>),
		Link: ({ children, to, ...props }: { children: React.ReactNode; to?: string }) => (
			<a href={String(to ?? "")} {...props}>
				{children}
			</a>
		),
		useParams: () => ({ slug: "footer" }),
		useNavigate: () => vi.fn(),
	};
});

const mockFetchSection = vi.fn<() => Promise<Section>>();
const mockUpdateSection = vi.fn();
const mockFetchManifest = vi.fn<() => Promise<AdminManifest>>();

vi.mock("../../../../../packages/admin/src/lib/api", async () => {
	const actual = await vi.importActual("../../../../../packages/admin/src/lib/api");
	return {
		...(actual as Record<string, unknown>),
		fetchSection: (...args: unknown[]) => mockFetchSection(...(args as [])),
		updateSection: (...args: unknown[]) => mockUpdateSection(...(args as [])),
		fetchManifest: (...args: unknown[]) => mockFetchManifest(...(args as [])),
	};
});

const { SectionEditor } =
	await import("../../../../../packages/admin/src/components/SectionEditor");

function makeSection(overrides: Partial<Section> = {}): Section {
	return {
		id: "sec_footer",
		slug: "footer",
		title: "Footer",
		description: "All page footer",
		keywords: [],
		content: [],
		source: "user",
		createdAt: "2025-01-01T00:00:00Z",
		updatedAt: "2025-01-02T00:00:00Z",
		...overrides,
	};
}

function makeManifest(overrides: Partial<AdminManifest> = {}): AdminManifest {
	return {
		version: "0.1.0",
		hash: "abc123",
		authMode: "passkey",
		collections: {},
		plugins: {},
		...overrides,
	};
}

function Wrapper({ children }: { children: React.ReactNode }) {
	const qc = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	return (
		<QueryClientProvider client={qc}>
			<Toasty>{children}</Toasty>
		</QueryClientProvider>
	);
}

describe("SectionEditor", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		portableTextProps.current = null;
		mockFetchSection.mockResolvedValue(makeSection());
		mockFetchManifest.mockResolvedValue(makeManifest());
	});

	it("opens the image settings panel when a block requests the sidebar", async () => {
		const screen = await render(<SectionEditor />, { wrapper: Wrapper });

		await expect.element(screen.getByTestId("portable-text-editor")).toBeInTheDocument();

		const onBlockSidebarOpen = portableTextProps.current?.onBlockSidebarOpen as
			| ((panel: unknown) => void)
			| undefined;
		const onBlockSidebarClose = portableTextProps.current?.onBlockSidebarClose as
			| (() => void)
			| undefined;

		expect(typeof onBlockSidebarOpen).toBe("function");
		expect(typeof onBlockSidebarClose).toBe("function");

		onBlockSidebarOpen!({
			type: "image",
			attrs: {
				src: "https://example.com/logo.png",
				alt: "Logo",
				mediaId: "media-1",
				width: 400,
				height: 200,
			},
			onUpdate: vi.fn(),
			onReplace: vi.fn(),
			onDelete: vi.fn(),
			onClose: vi.fn(),
		});

		await expect.element(screen.getByRole("img", { name: "Logo" })).toBeInTheDocument();
	});

	it("shows both clean save actions as Saved", async () => {
		const screen = await render(<SectionEditor />, { wrapper: Wrapper });

		await expect.element(screen.getByTestId("portable-text-editor")).toBeInTheDocument();
		const saveButtons = screen.getByRole("button", { name: "Saved", exact: true }).all();
		expect(saveButtons).toHaveLength(2);
		for (const button of saveButtons) await expect.element(button).toBeDisabled();
		expect(screen.getByRole("status").element().textContent).toBe("Saved");
	});

	it("passes plugin block definitions to PortableTextEditor", async () => {
		const manifest = makeManifest({
			plugins: {
				"plugin-embeds": {
					portableTextBlocks: [
						{
							type: "youtube",
							label: "YouTube",
							icon: "YoutubeLogo",
						},
					],
				},
			},
		});
		mockFetchManifest.mockResolvedValue(manifest);

		const screen = await render(<SectionEditor />, { wrapper: Wrapper });
		await expect.element(screen.getByTestId("portable-text-editor")).toBeInTheDocument();

		expect(portableTextProps.current?.pluginBlocks).toEqual([
			{
				type: "youtube",
				pluginId: "plugin-embeds",
				label: "YouTube",
				icon: "YoutubeLogo",
			},
		]);
	});
});
