const network = vi.hoisted(() => ({ GET: vi.fn() }));
vi.mock("../../../transport.js", () => network);
import { beforeEach, describe, expect, it, vi } from "vitest";

import { act, render, screen } from "../../../../../../../../../supbrd-front-ui/tests/render.js";
import Setup from "../Setup.js";

const mocks = vi.hoisted(() => ({
	project: {
		selectedProject: { id: "project-one" },
		selectedInstance: { role: "owner" },
	} as {
		selectedProject?: { id: string };
		selectedInstance?: { role?: string };
	},
}));

vi.mock(
	"../../../../../../../../../supbrd-front-ui/src/shared/context/useProjectSelection.js",
	() => ({
		useProjectSelection: () => mocks.project,
	}),
);

vi.mock("../../../../../../../../../supbrd-front-ui/src/shared/lib/LocalStorage.js", () => ({
	default: {
		getAuthenticationToken: () => "dashboard-token",
	},
}));

vi.mock("../../../../../../../../../supbrd-front-ui/src/shared/lib/config.js", () => ({
	config: {
		apiUrl: "https://api.example.test",
		apiPath: "/api/v1",
		authUrl: "https://auth.example.test",
	},
}));

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((promiseResolve) => {
		resolve = promiseResolve;
	});
	return { promise, resolve };
}

function jsonResponse(body: unknown, status = 200) {
	return { data: body, status };
}

describe("Identity Setup", () => {
	beforeEach(() => {
		mocks.project = {
			selectedProject: { id: "project-one" },
			selectedInstance: { role: "owner" },
		};
		window.sessionStorage.clear();
		vi.restoreAllMocks();
		network.GET.mockReset();
	});

	it("does not mount Melody pages before project configuration is ready", async () => {
		const configuration = deferred<{ data: unknown; status: number }>();
		const fetchMock = network.GET.mockImplementationOnce(
			() => configuration.promise,
		).mockResolvedValueOnce(
			jsonResponse({
				apps: [
					{
						clientId: "client-one",
						isActive: true,
						redirectUris: ["https://app.example.test/callback"],
						type: "spa",
					},
				],
			}),
		);

		render(
			<Setup>
				<div>Melody page content</div>
			</Setup>,
		);

		expect(screen.queryByText("Melody page content")).not.toBeInTheDocument();

		await act(async () => {
			configuration.resolve(jsonResponse({ configs: { ENABLE_ORG: true } }));
			await configuration.promise;
		});

		expect(await screen.findByText("Melody page content")).toBeInTheDocument();
		expect(fetchMock).toHaveBeenNthCalledWith(
			1,
			"/api/v1/identity-admin/projects/project-one",
			expect.objectContaining({ signal: expect.any(AbortSignal) }),
		);
	});

	it("keeps the previous project hidden and clears its primary app during a switch", async () => {
		network.GET.mockResolvedValueOnce(
			jsonResponse({ configs: { ENABLE_ORG: true } }),
		).mockResolvedValueOnce(
			jsonResponse({
				apps: [
					{
						clientId: "client-one",
						isActive: true,
						redirectUris: ["https://one.example.test/callback"],
						type: "spa",
					},
				],
			}),
		);

		const view = render(
			<Setup>
				<div>Melody page content</div>
			</Setup>,
		);

		expect(await screen.findByText("Melody page content")).toBeInTheDocument();
		expect(window.sessionStorage.getItem("superboard.identity.primaryApp")).toContain("client-one");

		const secondConfiguration = deferred<{ data: unknown; status: number }>();
		network.GET.mockImplementationOnce(() => secondConfiguration.promise).mockResolvedValueOnce(
			jsonResponse({ apps: [] }),
		);
		mocks.project = {
			selectedProject: { id: "project-two" },
			selectedInstance: { role: "owner" },
		};

		view.rerender(
			<Setup>
				<div>Melody page content</div>
			</Setup>,
		);

		expect(screen.queryByText("Melody page content")).not.toBeInTheDocument();
		expect(window.sessionStorage.getItem("superboard.identity.primaryApp")).toBeNull();

		await act(async () => {
			secondConfiguration.resolve(jsonResponse({ configs: { ENABLE_ORG: false } }));
			await secondConfiguration.promise;
		});

		expect(await screen.findByText("Melody page content")).toBeInTheDocument();
	});

	it("does not expose a partially initialized page when configuration fails", async () => {
		network.GET.mockResolvedValueOnce(
			jsonResponse({ error: { message: "Identity unavailable" } }, 503),
		);

		render(
			<Setup>
				<div>Melody page content</div>
			</Setup>,
		);

		expect(await screen.findByText("Identity request failed")).toBeInTheDocument();
		expect(screen.queryByText("Melody page content")).not.toBeInTheDocument();
	});
});
