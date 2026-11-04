import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen } from "../../../../../packages/supbrd-front-ui/render.js";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("@superboard/front-ui/navigation", async (importOriginal) => ({
	...(await importOriginal<typeof import("@superboard/front-ui/navigation")>()),
	useRouter: () => router,
}));

import CommunicationWorkspace from "../../../../../../../packages/plugins/superboard-communication/src/front/marketing/studio/CommunicationWorkspace.js";
import {
	workspaceHref,
	workspaceRedirect,
} from "../../../../../../../packages/plugins/superboard-communication/src/front/marketing/studio/workspace-navigation.js";

describe("Communication section addresses", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it.each([
		[
			"tab=contacts&q=ada%40example.test",
			"emails",
			"/communication/audience?tab=contacts&q=ada%40example.test",
		],
		["lang=fr&tab=suppressions", "senders", "/communication/audience?lang=fr&tab=suppressions"],
		["tab=senders&lang=fr", "emails", "/communication/settings?tab=senders&lang=fr"],
		["tab=automations", "contacts", "/communication/journeys?tab=automations"],
		["tab=operations", "in-app", "/communication/statistics?tab=operations"],
	])("moves the former section link ?%s from %s to its own page", (search, initialTab, target) => {
		expect(workspaceRedirect(new URLSearchParams(search), initialTab)).toBe(target);
	});

	it.each([
		["tab=languages", "senders"],
		["tab=email", "channels"],
		["", "statistics"],
		["tab=unknown&q=ada", "contacts"],
		["kind=automated", "emails"],
	])("keeps ?%s on the page opened with %s", (search, initialTab) => {
		expect(workspaceRedirect(new URLSearchParams(search), initialTab)).toBeNull();
	});

	it("sends the Authentication contact link to the filtered Audience contacts", () => {
		window.history.replaceState(
			null,
			"",
			"/communication/marketing-email?tab=contacts&q=user%40example.test",
		);
		render(<CommunicationWorkspace initialTab="emails" />);

		expect(screen.getByRole("status")).toHaveTextContent("Loading…");
		expect(screen.queryByRole("heading", { name: "Emails" })).not.toBeInTheDocument();
		expect(router.replace).toHaveBeenCalledWith(
			"/communication/audience?tab=contacts&q=user%40example.test",
		);
	});

	it("opens other sections on their own page and tabs of the same section in place", () => {
		const origin = "https://front.example.test";
		expect(
			workspaceHref(
				`${origin}/communication/marketing-email?lang=fr&kind=campaign&item=1&section=content`,
				"senders",
				"emails",
			),
		).toBe("/communication/settings?lang=fr&tab=senders");
		expect(
			workspaceHref(`${origin}/communication/journeys`, "emails", "automations", {
				kind: "automated",
			}),
		).toBe("/communication/marketing-email?tab=emails&kind=automated");
		expect(
			workspaceHref(
				`${origin}/communication/audience?tab=contacts&q=ada&contact=contact-1`,
				"lists",
				"contacts",
			),
		).toBe("/communication/audience?tab=lists&q=ada");
	});
});
