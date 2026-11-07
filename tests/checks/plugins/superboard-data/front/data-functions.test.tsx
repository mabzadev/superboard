import type { ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";

import FunctionsPage from "../../../../../packages/plugins/superboard-data/src/front/files/data/FunctionsPage.js";
import {
	FrontContextProvider,
	type FrontContextValue,
} from "../../../../../packages/supbrd-front-ui/src/context.js";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "../../../packages/supbrd-front-ui/render.js";

const api = vi.hoisted(() => ({
	GET: vi.fn(),
	POST: vi.fn(),
	PUT: vi.fn(),
	PATCH: vi.fn(),
	DELETE: vi.fn(),
}));
vi.mock("../../../../../packages/plugins/superboard-data/src/front/files/transport.js", () => api);
vi.mock("@superboard/front-ui/context/useProjectSelection.js", () => ({
	useProjectSelection: () => ({ selectedProject: { id: "prod" } }),
}));

const base = "/api/v1/files/projects/prod/data";
const hello = {
	name: "hello",
	access: "authenticated",
	active_version: 2,
	timeout_ms: 30_000,
	vars: { GREETING: "Bonjour" },
	secret_names: ["STRIPE_KEY"],
	schedule: null,
	created_at: "2026-11-07T10:00:00.000Z",
	updated_at: "2026-11-07T10:00:00.000Z",
};
const details = {
	...hello,
	source: "export default { fetch: () => new Response('v2') }",
	versions: [
		{ version: 2, source_hash: "b", created_by: "op", created_at: "2026-11-07T11:00:00.000Z" },
		{ version: 1, source_hash: "a", created_by: "op", created_at: "2026-11-07T10:00:00.000Z" },
	],
};

function serve(secrets: boolean) {
	api.GET.mockImplementation(async (path: string) => {
		const [route = ""] = path.split("?");
		if (route === `${base}/status`)
			return {
				data: {
					project_id: 12,
					features: {
						realtime: true,
						functions: true,
						function_secrets: secrets,
						image_transformations: false,
						vectors: false,
					},
					counts: { tables: 0, buckets: 0, functions: 1 },
				},
			};
		if (route === `${base}/functions`) return { data: { items: [hello] } };
		if (route === `${base}/functions/hello`) return { data: details };
		if (route === `${base}/functions/hello/runs`)
			return {
				data: {
					items: [
						{
							id: "run-1",
							version: 2,
							trigger: "cron",
							status: 500,
							outcome: "error",
							duration_ms: 31,
							logs: [{ level: "error", message: "boom", at: "2026-11-07T11:00:00.000Z" }],
							error: null,
							started_at: "2026-11-07T11:00:00.000Z",
						},
					],
				},
			};
		throw new Error(`Unexpected GET ${path}`);
	});
}

function renderIn(locale: "en" | "fr", ui: ReactNode) {
	const value: FrontContextValue = {
		instanceId: "1",
		pluginId: "superboard-files",
		path: "/data/functions",
		parameters: {},
		locale,
		operator: null,
		projectScope: null,
		activePluginIds: ["superboard-files"],
	};
	return render(<FrontContextProvider value={value}>{ui}</FrontContextProvider>);
}

beforeAll(() => {
	if (!("PointerEvent" in window))
		Object.defineProperty(window, "PointerEvent", { value: MouseEvent, configurable: true });
});
beforeEach(() => {
	window.history.replaceState(null, "", "/data/functions");
});
afterEach(() => {
	cleanup();
	vi.resetAllMocks();
	window.history.replaceState(null, "", "/");
});

it("flags a function whose secrets cannot be decrypted with « Secret manquant »", async () => {
	serve(false);
	renderIn("fr", <FunctionsPage />);
	const row = (await screen.findByRole("button", { name: "hello" })).closest("tr");
	if (!row) throw new Error("Function row missing");
	expect(await within(row).findByText("Secret manquant")).toBeVisible();
	expect(within(row).getByText("v2")).toBeVisible();
	expect(within(row).getByText("Utilisateurs connectés")).toBeVisible();
});

it("hides the secret form and explains why when the encryption key is missing", async () => {
	window.history.replaceState(null, "", "/data/functions?function=hello&tab=settings");
	serve(false);
	renderIn("en", <FunctionsPage />);
	expect(await screen.findByText("STRIPE_KEY")).toBeVisible();
	expect(screen.getAllByText("Secret missing").length).toBeGreaterThan(0);
	expect(screen.getByText(/The encryption key is not configured/u)).toBeVisible();
	expect(screen.queryByLabelText("Secret value")).not.toBeInTheDocument();
});

it("saves a secret without ever showing its value again", async () => {
	window.history.replaceState(null, "", "/data/functions?function=hello&tab=settings");
	serve(true);
	api.PUT.mockResolvedValue({ data: hello });
	renderIn("en", <FunctionsPage />);
	fireEvent.change(await screen.findByLabelText("Secret name"), { target: { value: "api_token" } });
	fireEvent.change(screen.getByLabelText("Secret value"), { target: { value: "s3cret" } });
	fireEvent.click(screen.getByRole("button", { name: "Save the secret" }));
	await waitFor(() => {
		expect(api.PUT).toHaveBeenCalledWith(`${base}/functions/hello`, {
			secrets: { API_TOKEN: "s3cret" },
		});
	});
	expect(await screen.findByText("Secret saved")).toBeVisible();
	expect(screen.getByLabelText("Secret value")).toHaveValue("");
	expect(screen.queryByDisplayValue("s3cret")).not.toBeInTheDocument();
});

it("runs a test invocation and shows the status, body and logs", async () => {
	window.history.replaceState(null, "", "/data/functions?function=hello&tab=test");
	serve(true);
	api.POST.mockResolvedValue({
		data: {
			run_id: "run-2",
			status: 201,
			headers: {},
			body: '{"ok":true}',
			logs: [{ level: "log", message: "called", at: "2026-11-07T11:00:00.000Z" }],
			duration_ms: 12,
		},
	});
	renderIn("en", <FunctionsPage />);
	fireEvent.change(await screen.findByLabelText("Path"), { target: { value: "/greet" } });
	fireEvent.change(screen.getByLabelText("Body"), { target: { value: '{"name":"Ada"}' } });
	fireEvent.click(screen.getByRole("button", { name: "Run the test" }));
	await waitFor(() => {
		expect(api.POST).toHaveBeenCalledWith(`${base}/functions/hello/invoke`, {
			method: "POST",
			path: "/greet",
			body: '{"name":"Ada"}',
		});
	});
	const response = await screen.findByRole("region", { name: "Response" });
	expect(within(response).getByText("201")).toBeVisible();
	expect(within(response).getByText('{"ok":true}')).toBeVisible();
	expect(within(response).getByText(/called/u)).toBeVisible();
	expect(within(response).getByText("Duration: 12 ms")).toBeVisible();
});

it("shows the logs of a recent run on request", async () => {
	window.history.replaceState(null, "", "/data/functions?function=hello&tab=runs");
	serve(true);
	renderIn("fr", <FunctionsPage />);
	const run = (await screen.findByText("Échouée")).closest("li");
	if (!run) throw new Error("Run missing");
	expect(within(run).getByText("Planification")).toBeVisible();
	expect(within(run).queryByText(/boom/u)).not.toBeInTheDocument();
	fireEvent.click(within(run).getByRole("button", { name: "Afficher les journaux" }));
	expect(within(run).getByText(/boom/u)).toBeVisible();
	expect(api.GET).toHaveBeenCalledWith(`${base}/functions/hello/runs?limit=50`);
});

it("reveals the cron field only when the schedule is switched on and saves it", async () => {
	window.history.replaceState(null, "", "/data/functions?function=hello&tab=schedule");
	serve(true);
	api.PUT.mockResolvedValue({
		data: {
			cron: "*/5 * * * *",
			enabled: true,
			next_run_at: "2026-11-07T12:05:00.000Z",
			last_run_at: null,
		},
	});
	renderIn("en", <FunctionsPage />);
	const toggle = await screen.findByRole("switch", { name: "Run on a schedule" });
	expect(screen.queryByLabelText("Cron expression")).not.toBeInTheDocument();
	fireEvent.click(toggle);
	fireEvent.change(screen.getByLabelText("Cron expression"), { target: { value: "*/5 * * * *" } });
	fireEvent.click(screen.getByRole("button", { name: "Save the schedule" }));
	await waitFor(() => {
		expect(api.PUT).toHaveBeenCalledWith(`${base}/functions/hello/schedule`, {
			cron: "*/5 * * * *",
		});
	});
	expect(await screen.findByText("Schedule saved")).toBeVisible();
});

it("deploys new source code and rolls back to an earlier version", async () => {
	window.history.replaceState(null, "", "/data/functions?function=hello");
	serve(true);
	api.PUT.mockResolvedValue({ data: { ...hello, active_version: 3 } });
	api.POST.mockResolvedValue({ data: { ...hello, active_version: 1 } });
	renderIn("en", <FunctionsPage />);
	const source = await screen.findByLabelText("Source code");
	expect(source).toHaveValue(details.source);
	fireEvent.change(source, {
		target: { value: "export default { fetch: () => new Response('v3') }" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Deploy" }));
	await waitFor(() => {
		expect(api.PUT).toHaveBeenCalledWith(`${base}/functions/hello`, {
			source: "export default { fetch: () => new Response('v3') }",
		});
	});
	expect(await screen.findByText("Version 3 deployed")).toBeVisible();
	fireEvent.click(screen.getByRole("button", { name: "Use version 1" }));
	await waitFor(() => {
		expect(api.POST).toHaveBeenCalledWith(`${base}/functions/hello/rollback`, { version: 1 });
	});
	expect(await screen.findByText("Version 1 is active")).toBeVisible();
});

it("creates a function from the template and opens it", async () => {
	serve(true);
	api.PUT.mockResolvedValue({ data: { ...hello, name: "greet", active_version: 1 } });
	renderIn("en", <FunctionsPage />);
	fireEvent.change(await screen.findByLabelText("Function name"), { target: { value: "greet" } });
	fireEvent.click(screen.getByRole("button", { name: "Deploy" }));
	await waitFor(() => {
		expect(api.PUT).toHaveBeenCalledWith(
			`${base}/functions/greet`,
			expect.objectContaining({
				access: "authenticated",
				source: expect.stringContaining("fetch"),
			}),
		);
	});
	await waitFor(() => {
		expect(new URLSearchParams(window.location.search).get("function")).toBe("greet");
	});
});
