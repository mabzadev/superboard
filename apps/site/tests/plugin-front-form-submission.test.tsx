import { FrontContextProvider } from "@superboard/front-ui/context";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import EmailPage from "../../../packages/supbrd-runtime-plugins/src/front/client/plugins/supbrd-plugmod-email/EmailPage.js";
import FilesPage from "../../../packages/supbrd-runtime-plugins/src/front/client/plugins/supbrd-plugmod-files/FilesPage.js";
import McpToolsPage from "../../../packages/supbrd-runtime-plugins/src/front/client/plugins/supbrd-plugmod-mcp/McpToolsPage.js";

const selection = vi.hoisted(() => ({ selectedProject: { id: "42-prod" } }));
vi.mock("../../../packages/supbrd-front-ui/src/shared/context/useProjectSelection.js", () => ({
	useProjectSelection: () => selection,
}));
vi.mock(
	"../../../packages/supbrd-runtime-plugins/src/front/client/plugins/supbrd-plugmod-email/source/components/modules/EmailAdministration.js",
	() => ({ EmailAdministration: () => null }),
);
vi.mock(
	"../../../packages/supbrd-runtime-plugins/src/front/client/plugins/supbrd-plugmod-email/source/api/email/emailService.js",
	() => ({ sendTransactionalEmail: async () => ({ id: "queued-message" }) }),
);
vi.mock(
	"../../../packages/supbrd-runtime-plugins/src/front/client/plugins/supbrd-plugmod-files/transport.js",
	() => ({
		GET: async (path: string) => ({
			data: {
				data: path.endsWith("/usage") ? { files: 0, bytes: 0 } : { items: [], next_cursor: null },
			},
		}),
		POST: async () => ({ data: { data: { id: "upload-ticket", upload_url: "/upload" } } }),
		PUT: async () => ({}),
		DELETE: async () => ({}),
	}),
);
vi.mock(
	"../../../packages/supbrd-runtime-plugins/src/front/client/plugins/supbrd-plugmod-mcp/transport.js",
	() => ({
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
	}),
);

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

test("clicking Send submits the email and displays its accepted state", async () => {
	await render(<EmailPage />);
	await click("Compose");
	await fill('[name="recipient"]', "recipient@example.test");
	await fill('[name="subject"]', "Delivery test");
	await fill('[name="body"]', "A real button submission");
	await click("Send");
	expect(container.querySelector('[role="status"]')?.textContent).toBe(
		"Message accepted for delivery",
	);
});

test("clicking Run tool displays the completed invocation", async () => {
	await render(<McpToolsPage />);
	await click("Run tool");
	expect(container.textContent).toContain("Runtime is ready");
	expect(container.textContent).toContain("completed-session");
});
