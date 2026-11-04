import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
	showErrorNotificationWithLink,
	showGenericError,
} from "../../../../../../../packages/supbrd-front-ui/src/shared/lib/Notifications.js";
import { toast, Toaster } from "../../../../../../../packages/supbrd-front-ui/src/toaster.js";

afterEach(() => {
	act(() => {
		toast.dismiss();
	});
	document.documentElement.lang = "";
});

describe("generic notifications", () => {
	it("speak the language of the page", async () => {
		document.documentElement.lang = "fr";
		render(<Toaster />);
		act(() => {
			showGenericError();
			showErrorNotificationWithLink("Export indisponible", vi.fn());
		});
		expect(
			await screen.findByText("Une erreur s’est produite, veuillez réessayer"),
		).toBeInTheDocument();
		expect(await screen.findByRole("button", { name: "Voir" })).toBeInTheDocument();
	});

	it("keep English on English pages", async () => {
		document.documentElement.lang = "en";
		render(<Toaster />);
		act(() => {
			showGenericError();
		});
		expect(await screen.findByText("Something went wrong, please try again")).toBeInTheDocument();
	});
});
