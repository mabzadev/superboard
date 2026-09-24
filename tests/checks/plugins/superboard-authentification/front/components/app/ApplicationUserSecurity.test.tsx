import { beforeEach, expect, it, vi } from "vitest";

import ApplicationUserSecurity from "../../../../../../../packages/plugins/superboard-authentification/src/front/ApplicationUserSecurity.js";
import { fireEvent, render, screen } from "../../../../../packages/supbrd-front-ui/render.js";

const state = vi.hoisted(() => ({ suspended: true, revoked: false, linked: true, fail: false }));
vi.mock(
	"../../../../../../../packages/plugins/superboard-authentification/src/front/transport.js",
	() => ({
		GET: vi.fn(async () => {
			if (state.fail) throw new Error("offline");
			return {
				data: {
					data: {
						suspended: state.suspended,
						suspension: state.suspended ? { reason: "Review" } : null,
						directory_subject: state.linked ? "user-1" : null,
						nextCursor: null,
						items: [
							{
								id: "session-1",
								created_at: "2026-09-01",
								expires_at: "2099-01-01",
								revoked_at: null,
								status: state.revoked ? "revoked" : "active",
							},
						],
					},
				},
			};
		}),
		POST: vi.fn(async (path: string) => {
			if (path.endsWith("/resume")) state.suspended = false;
			if (path.endsWith("/revoke")) state.revoked = true;
			return {};
		}),
	}),
);
beforeEach(() =>
	Object.assign(state, { suspended: true, revoked: false, linked: true, fail: false }),
);
const mount = () =>
	render(
		<ApplicationUserSecurity
			projectRef="1-test"
			userId="user-1"
			onChange={async () => undefined}
		/>,
	);

it("shows the linked identity and updates account and session state after actions", async () => {
	mount();
	expect(await screen.findByRole("link", { name: "Manage identity" })).toHaveAttribute(
		"href",
		"/auth/directory/users/user-1?lang=en",
	);
	fireEvent.click(await screen.findByRole("button", { name: "Reactivate account" }));
	expect(await screen.findByText("Account active")).toBeVisible();
	fireEvent.click(screen.getByRole("button", { name: "Revoke session" }));
	expect(await screen.findByText("Revoked")).toBeVisible();
	expect(screen.queryByRole("button", { name: "Revoke session" })).not.toBeInTheDocument();
});
it("does not offer identity actions for an unlinked account", async () => {
	state.linked = false;
	mount();
	expect(await screen.findByText("This account has no linked directory identity.")).toBeVisible();
	expect(screen.queryByRole("link", { name: "Manage identity" })).not.toBeInTheDocument();
});
it("allows retrying a failed security read", async () => {
	state.fail = true;
	mount();
	expect(await screen.findByRole("alert")).toBeVisible();
	state.fail = false;
	fireEvent.click(screen.getByRole("button", { name: "Retry" }));
	expect(await screen.findByRole("button", { name: "Reactivate account" })).toBeVisible();
});
