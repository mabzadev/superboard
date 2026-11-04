import { afterEach, describe, expect, it, vi } from "vitest";

import ChannelsView from "../../../../../../../packages/plugins/superboard-support/src/front/views/superboard.support_channels.js";
import ContactsView from "../../../../../../../packages/plugins/superboard-support/src/front/views/superboard.support_contacts.js";
import { render } from "../../../../../packages/supbrd-front-ui/render.js";

const browserLocation = window.location;

function openLegacyAddress(address: string) {
	const replace = vi.fn<(target: URL) => void>();
	Object.defineProperty(window, "location", {
		configurable: true,
		writable: true,
		value: { href: new URL(address, "https://site.example.test").toString(), replace },
	});
	return replace;
}

function redirectedTo(replace: ReturnType<typeof openLegacyAddress>) {
	expect(replace).toHaveBeenCalledTimes(1);
	const target = replace.mock.calls[0]?.[0];
	if (!target) throw new Error("The legacy address did not redirect");
	return target;
}

describe("legacy Support addresses", () => {
	afterEach(() => {
		Object.defineProperty(window, "location", {
			configurable: true,
			writable: true,
			value: browserLocation,
		});
	});

	it("keeps the channel authorization return when it forwards to the Inbox channels", () => {
		const replace = openLegacyAddress(
			"/support/channels?connection=provider-1&support_result=success&support_code=configuration_pending&lang=fr",
		);
		render(<ChannelsView />);

		const target = redirectedTo(replace);
		expect(target.pathname).toBe("/support/inbox");
		expect(target.searchParams.get("section")).toBe("channels");
		expect(target.searchParams.get("connection")).toBe("provider-1");
		expect(target.searchParams.get("support_result")).toBe("success");
		expect(target.searchParams.get("support_code")).toBe("configuration_pending");
		expect(target.searchParams.get("lang")).toBe("fr");
	});

	it("lets the destination choose its own tab over a legacy one", () => {
		const replace = openLegacyAddress("/support/contacts?tab=directory&contact=contact-1");
		render(<ContactsView />);

		const target = redirectedTo(replace);
		expect(target.pathname).toBe("/support/settings");
		expect(target.searchParams.get("tab")).toBe("contacts");
		expect(target.searchParams.get("contact")).toBe("contact-1");
	});
});
