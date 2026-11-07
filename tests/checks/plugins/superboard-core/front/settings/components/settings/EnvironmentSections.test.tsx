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

const mocks = vi.hoisted(() => ({
	getSdkConfiguration: vi.fn(),
	deleteInstance: vi.fn(),
	addMember: vi.fn(),
	removeMember: vi.fn(),
	refetchInstances: vi.fn(),
}));

vi.mock(
	"../../../../../../../../packages/plugins/superboard-core/src/front/settings/api/app/appService.js",
	() => ({ getSdkConfiguration: mocks.getSdkConfiguration }),
);
vi.mock(
	"../../../../../../../../packages/plugins/superboard-core/src/front/settings/hooks/queries/useInstanceQueries.js",
	() => ({
		useInstancesQuery: () => ({ refetch: mocks.refetchInstances }),
		useInstanceMembersQuery: () => ({
			isSuccess: true,
			data: {
				members: [
					{ user: { id: "owner-1", name: "Ada Admin", email: "ada@example.test" }, role: "admin" },
					{ user: { id: "member-1", email: "invitee@example.test" }, role: "member" },
				],
			},
		}),
	}),
);
vi.mock(
	"../../../../../../../../packages/plugins/superboard-core/src/front/settings/hooks/mutations/useInstanceMutations.js",
	() => ({
		useDeleteInstanceMutation: () => ({ mutateAsync: mocks.deleteInstance }),
		useAddMemberMutation: () => ({ mutateAsync: mocks.addMember }),
		useRemoveMemberMutation: () => ({ mutateAsync: mocks.removeMember }),
	}),
);
vi.mock(
	"../../../../../../../../packages/supbrd-front-ui/src/shared/context/useProjectSelection.js",
	() => ({
		useProjectSelection: () => ({
			selectedInstance: {
				id: "10",
				name: "Demo project",
				role: "owner",
				production: { name: "Demo production" },
				test: { name: "Demo test" },
			},
			selectedProject: { id: "10-prod" },
			projectType: "production",
			setSelectedInstance: vi.fn(),
		}),
	}),
);
vi.mock("../../../../../../../../packages/supbrd-front-ui/src/shared/lib/Notifications.js", () => ({
	showGenericError: vi.fn(),
	showSuccessNotification: vi.fn(),
}));

import GeneralSection from "../../../../../../../../packages/plugins/superboard-core/src/front/settings/components/settings/GeneralSection.js";
import ProjectAdvancedSection from "../../../../../../../../packages/plugins/superboard-core/src/front/settings/components/settings/ProjectAdvancedSection.js";
import TeamMebersSection from "../../../../../../../../packages/plugins/superboard-core/src/front/settings/components/settings/TeamMebersSection.js";

function wrapper(locale: "en" | "fr") {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return function Providers({ children }: { children: ReactNode }) {
		return (
			<FrontContextProvider
				value={{
					instanceId: "1",
					pluginId: "superboard-settings",
					path: "/core/settings",
					parameters: {},
					locale,
					operator: { id: "owner-1", email: "ada@example.test", name: "Ada Admin", role: 50 },
					projectScope: null,
					activePluginIds: ["superboard-settings"],
				}}
			>
				<QueryClientProvider client={client}>{children}</QueryClientProvider>
			</FrontContextProvider>
		);
	};
}

function confirmDialog() {
	return within(screen.getByRole("dialog"));
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.getSdkConfiguration.mockImplementation(async (_project: string, platform: string) =>
		platform === "ios"
			? null
			: {
					platform,
					status: "configured",
					configuration: { maintenance_enabled: platform === "web" },
					updated_at: "2026-11-05T00:00:00Z",
				},
	);
	mocks.deleteInstance.mockResolvedValue(undefined);
	mocks.addMember.mockResolvedValue(undefined);
	mocks.removeMember.mockResolvedValue(undefined);
	mocks.refetchInstances.mockResolvedValue({ data: [] });
});

describe("Environment general settings", () => {
	it("shows each platform's maintenance state from its SDK configuration", async () => {
		render(<GeneralSection />, { wrapper: wrapper("en") });

		const web = (await screen.findByText("Maintenance on")).parentElement!.parentElement!;
		expect(within(web).getByText("Web")).toBeInTheDocument();
		expect(within(web).getByRole("link", { name: "Configure Web" })).toHaveAttribute(
			"href",
			"/core/libraries?tab=web",
		);
		const ios = (await screen.findByText("Not configured")).parentElement!.parentElement!;
		expect(within(ios).getByText("iOS")).toBeInTheDocument();
		const android = (await screen.findByText("Off")).parentElement!.parentElement!;
		expect(within(android).getByText("Android")).toBeInTheDocument();
		expect(mocks.getSdkConfiguration).toHaveBeenCalledWith("10-prod", "android");
	});

	it("no longer offers to delete the project from the environment settings", async () => {
		render(<GeneralSection />, { wrapper: wrapper("en") });

		await screen.findByText("Maintenance on");
		expect(screen.queryByRole("button", { name: "Delete Project" })).toBeNull();
	});
});

describe("Environment advanced settings", () => {
	it("deletes the whole project only after the French confirmation", async () => {
		render(<ProjectAdvancedSection />, { wrapper: wrapper("fr") });

		expect(screen.getByRole("heading", { name: "Actions sur tout le projet" })).toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "Supprimer le projet" }));
		expect(mocks.deleteInstance).not.toHaveBeenCalled();
		expect(confirmDialog().getByText("Supprimer ce projet ?")).toBeInTheDocument();

		fireEvent.click(confirmDialog().getByRole("button", { name: "Supprimer le projet" }));
		await waitFor(() => {
			expect(mocks.deleteInstance).toHaveBeenCalledWith("10");
		});
	});
});

describe("Environment team settings", () => {
	it("shows localized roles and removes a member only after confirmation", async () => {
		render(<TeamMebersSection />, { wrapper: wrapper("fr") });

		expect(screen.getByText("Administrateur")).toBeInTheDocument();
		expect(screen.getByText("Membre")).toBeInTheDocument();
		expect(screen.getByText("Invité")).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "Retirer ada@example.test" })).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "Retirer invitee@example.test" }));
		expect(mocks.removeMember).not.toHaveBeenCalled();
		expect(confirmDialog().getByText("Retirer ce membre ?")).toBeInTheDocument();

		fireEvent.click(confirmDialog().getByRole("button", { name: "Retirer" }));
		await waitFor(() => {
			expect(mocks.removeMember).toHaveBeenCalledWith("invitee@example.test");
		});
	});

	it("invites a member from a one-column French dialog once the address is valid", async () => {
		render(<TeamMebersSection />, { wrapper: wrapper("fr") });

		fireEvent.click(screen.getByRole("button", { name: "Ajouter un membre" }));
		const dialog = confirmDialog();
		const submit = dialog.getByRole("button", { name: "Ajouter le membre" });
		expect(submit).toBeDisabled();

		fireEvent.change(dialog.getByLabelText("Adresse e-mail"), {
			target: { value: "new@example.test" },
		});
		await waitFor(() => {
			expect(submit).toBeEnabled();
		});
		fireEvent.click(submit);
		await waitFor(() => {
			expect(mocks.addMember).toHaveBeenCalledWith({ email: "new@example.test", role: "member" });
		});
	});
});
