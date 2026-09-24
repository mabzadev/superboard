import { FrontContextProvider } from "@superboard/front-ui/context";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { EmailEditor } from "../../../../packages/plugins/superboard-communication/src/front/marketing/studio/EmailEditor.js";
import McpToolsPage from "../../../../packages/plugins/superboard-core/src/front/mcp/McpToolsPage.js";
import FilesPage from "../../../../packages/plugins/superboard-data/src/front/files/FilesPage.js";

const selection = vi.hoisted(() => ({ selectedProject: { id: "42-prod" } }));
vi.mock("../../../../packages/supbrd-front-ui/src/shared/context/useProjectSelection.js", () => ({
	useProjectSelection: () => selection,
}));
vi.mock(
	"../../../../packages/plugins/superboard-communication/src/front/marketing/studio/service.js",
	() => ({
		testStudioEmail: async () => ({ queued: true }),
		getEmailVersions: async () => [],
		publishStudioTemplate: async () => ({}),
		translateStudioEmail: async () => ({}),
		getSharedEmailBlocks: async () => [],
		createSharedEmailBlock: async () => ({}),
		updateSharedEmailBlock: async () => ({}),
		getSharedEmailBlockUsage: async () => [],
		applySharedEmailBlock: async () => ({}),
	}),
);
vi.mock("../../../../packages/plugins/superboard-data/src/front/files/transport.js", () => ({
	GET: async (path: string) => ({
		data: {
			data: path.endsWith("/usage") ? { files: 0, bytes: 0 } : { items: [], next_cursor: null },
		},
	}),
	POST: async () => ({ data: { data: { id: "upload-ticket", upload_url: "/upload" } } }),
	PUT: async () => ({}),
	DELETE: async () => ({}),
}));
vi.mock("../../../../packages/plugins/superboard-core/src/front/mcp/transport.js", () => ({
	GET: async () => ({
		data: {
			data: { tools: [{ name: "get_status", inputSchema: {} }], items: [], next_cursor: null },
			tokens: [],
		},
	}),
	POST: async () => ({
		data: { data: { session_id: "completed-session", result: "Runtime is ready" } },
	}),
	DELETE: async () => ({}),
}));

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
	Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
		configurable: true,
		value: true,
	});
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});
async function render(node: ReactNode) {
	await act(async () =>
		root.render(
			<FrontContextProvider
				value={{
					instanceId: "42",
					pluginId: "supbrd-plugmod-email",
					operator: null,
					projectScope: null,
					activePluginIds: ["supbrd-plugmod-email", "supbrd-plugmod-files", "supbrd-plugmod-mcp"],
					parameters: {},
					path: "/email",
					locale: "en",
				}}
			>
				{node}
			</FrontContextProvider>,
		),
	);
}
async function click(label: string) {
	const button = [...container.querySelectorAll("button")].find(
		(item) => item.textContent === label,
	);
	expect(button).toBeDefined();
	await act(async () => button!.click());
}
async function fill(selector: string, value: string) {
	const input = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
	const prototype =
		input instanceof HTMLTextAreaElement
			? HTMLTextAreaElement.prototype
			: HTMLInputElement.prototype;
	await act(async () => {
		Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(input, value);
		input.dispatchEvent(new Event("input", { bubbles: true }));
	});
}

test("clicking Upload submits the chosen file and displays completion", async () => {
	await render(<FilesPage />);
	const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
	await act(async () => {
		Object.defineProperty(input, "files", {
			value: [new File(["hello"], "greeting.txt", { type: "text/plain" })],
		});
		input.dispatchEvent(new Event("change", { bubbles: true }));
	});
	await click("Upload");
	expect(container.querySelector('[role="status"]')?.textContent).toBe("File saved");
});

test("clicking Send a test submits the email and displays its accepted state", async () => {
	await render(
		<EmailEditor
			project="42-prod"
			template={{ id: "template-1", name: "Delivery test" } as never}
			onSave={async () => ({}) as never}
			onBack={() => {}}
		/>,
	);
	await click("Preview");
	await fill('input[type="email"]', "recipient@example.test");
	await click("Send a test");
	expect(
		[...container.querySelectorAll('[role="status"]')].some(
			(item) => item.textContent === "Test sent",
		),
	).toBe(true);
});

test("clicking Run tool displays the completed invocation", async () => {
	await render(<McpToolsPage />);
	await click("Run tool");
	expect(container.textContent).toContain("Runtime is ready");
	expect(container.textContent).toContain("completed-session");
});
