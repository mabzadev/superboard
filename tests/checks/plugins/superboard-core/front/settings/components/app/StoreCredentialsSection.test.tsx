import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FrontContextProvider } from "../../../../../../../../packages/supbrd-front-ui/src/context.js";
import {
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "../../../../../../packages/supbrd-front-ui/render.js";

const network = vi.hoisted(() => ({
	getProjectConfigurationAPICall: vi.fn(),
	setIOSApiAccessKeyAPICall: vi.fn(),
	setAndroidAppConfigAPICall: vi.fn(),
	setAndroidAppWebhookAccessKeyAPICall: vi.fn(),
}));
const notifications = vi.hoisted(() => ({
	showSuccessNotification: vi.fn(),
	showErrorNotification: vi.fn(),
}));

vi.mock(
	"../../../../../../../../packages/plugins/superboard-core/src/front/settings/api/applications/configApplicationsService.js",
	() => network,
);
vi.mock(
	"../../../../../../../../packages/supbrd-front-ui/src/shared/lib/Notifications.js",
	() => notifications,
);
vi.mock(
	"../../../../../../../../packages/supbrd-front-ui/src/shared/context/useProjectSelection.js",
	() => ({ useProjectSelection: () => ({ selectedInstance: { id: "10", role: "owner" } }) }),
);

import StoreCredentialsSection from "../../../../../../../../packages/plugins/superboard-core/src/front/settings/components/app/StoreCredentialsSection.js";

const registration = {
	bundle_id: "com.example.fake",
	team_id: "FAKETEAM12",
	package_name: "com.example.fake",
	sha256: "AA:BB:CC",
};
const fakeAppleKey = [
	"-----BEGIN PRIVATE KEY-----",
	"ZmFrZS1hcHBsZS1rZXk=",
	"-----END PRIVATE KEY-----",
].join("\n");
const fakeServiceAccount = JSON.stringify({
	type: "service_account",
	project_id: "fake-play-project",
	private_key: fakeAppleKey,
	client_email: "billing@fake-play-project.iam.gserviceaccount.com",
});

let configurations: unknown[] = [];

if (typeof Blob.prototype.text !== "function")
	Blob.prototype.text = function text(this: Blob) {
		return new Promise<string>((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => {
				resolve(typeof reader.result === "string" ? reader.result : "");
			};
			reader.onerror = () => {
				reject(reader.error ?? new Error("Unable to read the file"));
			};
			reader.readAsText(this);
		});
	};

function wrapper(locale: "en" | "fr") {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	return function Providers({ children }: { children: ReactNode }) {
		return (
			<FrontContextProvider
				value={{
					instanceId: "1",
					pluginId: "superboard-settings",
					path: "/core/libraries",
					parameters: {},
					locale,
					operator: null,
					projectScope: null,
					activePluginIds: ["superboard-settings"],
				}}
			>
				<QueryClientProvider client={client}>{children}</QueryClientProvider>
			</FrontContextProvider>
		);
	};
}

function show(platform: "ios" | "android", locale: "en" | "fr" = "en") {
	return render(<StoreCredentialsSection platform={platform} registration={registration} />, {
		wrapper: wrapper(locale),
	});
}

function choose(label: string, content: string, name: string) {
	fireEvent.change(screen.getByLabelText(label), {
		target: { files: [new File([content], name)] },
	});
}

function type(label: string, value: string) {
	fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function sentForm(call: ReturnType<typeof vi.fn>) {
	const form = call.mock.calls[0]?.[1];
	expect(form).toBeInstanceOf(FormData);
	return form as FormData;
}

const configuredApple = {
	platform: "ios",
	configuration: {
		bundle_id: "com.example.fake",
		app_prefix: "FAKETEAM12",
		app_apple_id: 1234567890,
		server_api_key: { id: "key-1", key_id: "FAKEKEY123", configured: true },
	},
};

beforeEach(() => {
	vi.clearAllMocks();
	configurations = [];
	network.getProjectConfigurationAPICall.mockImplementation(async () => ({
		data: { configurations },
	}));
	network.setIOSApiAccessKeyAPICall.mockResolvedValue({ data: {} });
	network.setAndroidAppConfigAPICall.mockResolvedValue({ data: {} });
	network.setAndroidAppWebhookAccessKeyAPICall.mockResolvedValue({ data: {} });
});

describe("App Store Server API credentials", () => {
	it("saves a first key with the identifiers required by purchase verification", async () => {
		show("ios");
		expect(await screen.findByText("Not configured")).toBeInTheDocument();

		type("Key ID", " FAKEKEY123 ");
		type("Issuer ID", "00000000-0000-0000-0000-000000000000");
		type("Apple app ID", "1234567890");
		choose("Private key (.p8)", fakeAppleKey, "AuthKey_FAKEKEY123.p8");
		network.setIOSApiAccessKeyAPICall.mockImplementation(async () => {
			configurations = [configuredApple];
			return { data: {} };
		});
		fireEvent.click(screen.getByRole("button", { name: "Save credentials" }));

		await waitFor(() => expect(network.setIOSApiAccessKeyAPICall).toHaveBeenCalledOnce());
		expect(network.setIOSApiAccessKeyAPICall.mock.calls[0]?.[0]).toBe("10");
		const form = sentForm(network.setIOSApiAccessKeyAPICall);
		expect(form.get("key_id")).toBe("FAKEKEY123");
		expect(form.get("issuer_id")).toBe("00000000-0000-0000-0000-000000000000");
		expect(form.get("app_apple_id")).toBe("1234567890");
		expect(form.get("bundle_id")).toBe("com.example.fake");
		expect(form.get("team_id")).toBe("FAKETEAM12");
		await expect((form.get("file") as File).text()).resolves.toBe(fakeAppleKey);
		expect(await screen.findByText("Configured")).toBeInTheDocument();
		expect(screen.queryByLabelText("Private key (.p8)")).toBeNull();
		expect(notifications.showSuccessNotification).toHaveBeenCalledWith("Store credentials saved");
	});

	it("shows only the status of a configured key and asks before replacing it", async () => {
		configurations = [configuredApple];
		show("ios");

		expect(await screen.findByText("Configured")).toBeInTheDocument();
		expect(screen.getByText("FAKEKEY123")).toBeInTheDocument();
		expect(screen.queryByLabelText("Private key (.p8)")).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "Replace credentials" }));
		expect(screen.getByLabelText("Apple app ID")).toHaveValue("1234567890");
		type("Key ID", "NEWKEY4567");
		type("Issuer ID", "00000000-0000-0000-0000-000000000000");
		choose("Private key (.p8)", fakeAppleKey, "AuthKey_NEWKEY4567.p8");
		fireEvent.click(screen.getByRole("button", { name: "Save credentials" }));

		const dialog = await screen.findByRole("alertdialog");
		expect(within(dialog).getByText("Replace the configured credentials?")).toBeInTheDocument();
		expect(network.setIOSApiAccessKeyAPICall).not.toHaveBeenCalled();
		fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
		await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
		expect(network.setIOSApiAccessKeyAPICall).not.toHaveBeenCalled();

		fireEvent.click(screen.getByRole("button", { name: "Save credentials" }));
		fireEvent.click(
			within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Replace" }),
		);
		await waitFor(() => expect(network.setIOSApiAccessKeyAPICall).toHaveBeenCalledOnce());
		expect(sentForm(network.setIOSApiAccessKeyAPICall).get("key_id")).toBe("NEWKEY4567");
	});

	it("rejects a file that is not a .p8 private key without sending it", async () => {
		show("ios");
		await screen.findByText("Not configured");

		type("Key ID", "FAKEKEY123");
		type("Issuer ID", "00000000-0000-0000-0000-000000000000");
		type("Apple app ID", "1234567890");
		choose("Private key (.p8)", "not a key", "notes.p8");
		fireEvent.click(screen.getByRole("button", { name: "Save credentials" }));

		expect(await screen.findByRole("alert")).toHaveTextContent(
			"Choose the .p8 private key downloaded from App Store Connect.",
		);
		expect(network.setIOSApiAccessKeyAPICall).not.toHaveBeenCalled();
	});

	it("explains that the configured key was kept when the billing copy cannot be made", async () => {
		configurations = [configuredApple];
		network.setIOSApiAccessKeyAPICall.mockRejectedValue(
			Object.assign(new Error("Billing unavailable"), {
				status: 503,
				code: "billing_credential_copy_failed",
			}),
		);
		show("ios");
		fireEvent.click(await screen.findByRole("button", { name: "Replace credentials" }));
		type("Key ID", "NEWKEY4567");
		type("Issuer ID", "00000000-0000-0000-0000-000000000000");
		choose("Private key (.p8)", fakeAppleKey, "AuthKey_NEWKEY4567.p8");
		fireEvent.click(screen.getByRole("button", { name: "Save credentials" }));
		fireEvent.click(
			within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Replace" }),
		);

		expect(await screen.findByRole("alert")).toHaveTextContent(
			"The billing service could not secure a copy of these credentials. The configured credentials were not changed; try again in a few minutes.",
		);
		expect(screen.getByText("Configured")).toBeInTheDocument();
	});

	it("waits for the bundle ID of step 1 before registering a new application", async () => {
		render(
			<StoreCredentialsSection
				platform="ios"
				registration={{ ...registration, bundle_id: "", team_id: "" }}
			/>,
			{ wrapper: wrapper("en") },
		);

		expect(
			await screen.findByText("Enter the bundle ID and Apple Team ID in step 1 first."),
		).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Save credentials" })).toBeDisabled();
	});

	it("renders the section in French", async () => {
		configurations = [configuredApple];
		show("ios", "fr");

		expect(await screen.findByText("Configuré")).toBeInTheDocument();
		expect(screen.getByRole("heading", { name: "App Store Server API" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Remplacer les identifiants" })).toBeInTheDocument();
	});
});

describe("Google Play Developer API credentials", () => {
	it("registers the Android application of step 1 before saving the first service account", async () => {
		configurations = [{ platform: "android", configuration: null }];
		show("android");
		expect(await screen.findByText("Not configured")).toBeInTheDocument();

		choose("Service account key (.json)", fakeServiceAccount, "service-account.json");
		fireEvent.click(screen.getByRole("button", { name: "Save credentials" }));

		await waitFor(() =>
			expect(network.setAndroidAppWebhookAccessKeyAPICall).toHaveBeenCalledOnce(),
		);
		expect(network.setAndroidAppConfigAPICall).toHaveBeenCalledWith("10", {
			package_name: "com.example.fake",
			sha256s: ["AA:BB:CC"],
		});
		expect(network.setAndroidAppConfigAPICall.mock.invocationCallOrder[0]).toBeLessThan(
			network.setAndroidAppWebhookAccessKeyAPICall.mock.invocationCallOrder[0]!,
		);
		const form = sentForm(network.setAndroidAppWebhookAccessKeyAPICall);
		expect((form.get("file") as File).name).toBe("service-account.json");
	});

	it("keeps the registered application and shows the service account of a configured key", async () => {
		configurations = [
			{
				platform: "android",
				configuration: {
					identifier: "com.example.fake",
					server_api_key: {
						id: "key-1",
						client_email: "billing@fake-play-project.iam.gserviceaccount.com",
					},
				},
			},
		];
		show("android");

		expect(await screen.findByText("Configured")).toBeInTheDocument();
		expect(
			screen.getByText("billing@fake-play-project.iam.gserviceaccount.com"),
		).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "Replace credentials" }));
		choose("Service account key (.json)", fakeServiceAccount, "service-account.json");
		fireEvent.click(screen.getByRole("button", { name: "Save credentials" }));
		fireEvent.click(
			within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Replace" }),
		);

		await waitFor(() =>
			expect(network.setAndroidAppWebhookAccessKeyAPICall).toHaveBeenCalledOnce(),
		);
		expect(network.setAndroidAppConfigAPICall).not.toHaveBeenCalled();
	});

	it("rejects a JSON file that is not a service account key without sending it", async () => {
		configurations = [{ platform: "android", configuration: { identifier: "com.example.fake" } }];
		show("android");
		await screen.findByText("Not configured");

		choose("Service account key (.json)", '{"type":"authorized_user"}', "credentials.json");
		fireEvent.click(screen.getByRole("button", { name: "Save credentials" }));

		expect(await screen.findByRole("alert")).toHaveTextContent(
			"Choose the JSON key of a Google Cloud service account.",
		);
		expect(network.setAndroidAppWebhookAccessKeyAPICall).not.toHaveBeenCalled();
	});
});
