import { userEvent } from "@vitest/browser/context";
import * as React from "react";
import { describe, it, expect, vi } from "vitest";

import { useStableCallback } from "../../../../../packages/admin/src/lib/hooks";
import { render } from "../utils/render.tsx";

function KeydownListener({ onEscape }: { onEscape: () => void }) {
	const stableOnEscape = useStableCallback(onEscape);

	React.useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (e.key === "Escape") stableOnEscape();
		};
		document.addEventListener("keydown", handler);
		return () => document.removeEventListener("keydown", handler);
	}, [stableOnEscape]);

	return <div data-testid="listener">Listening</div>;
}

describe("useStableCallback", () => {
	it("calls the latest callback after re-render with new identity", async () => {
		const first = vi.fn();
		const second = vi.fn();

		const screen = await render(<KeydownListener onEscape={first} />);
		await expect.element(screen.getByTestId("listener")).toBeInTheDocument();

		await userEvent.keyboard("{Escape}");
		expect(first).toHaveBeenCalledTimes(1);

		await screen.rerender(<KeydownListener onEscape={second} />);

		await userEvent.keyboard("{Escape}");
		expect(second).toHaveBeenCalledTimes(1);
		expect(first).toHaveBeenCalledTimes(1);
	});

	it("does not add/remove listeners on re-render", async () => {
		const addSpy = vi.spyOn(document, "addEventListener");
		const removeSpy = vi.spyOn(document, "removeEventListener");

		const screen = await render(<KeydownListener onEscape={vi.fn()} />);
		await expect.element(screen.getByTestId("listener")).toBeInTheDocument();

		const addCountAfterMount = addSpy.mock.calls.filter(([type]) => type === "keydown").length;
		const removeCountAfterMount = removeSpy.mock.calls.filter(
			([type]) => type === "keydown",
		).length;

		for (let i = 0; i < 3; i++) {
			await screen.rerender(<KeydownListener onEscape={vi.fn()} />);
		}

		const addCountAfterRerenders = addSpy.mock.calls.filter(([type]) => type === "keydown").length;
		const removeCountAfterRerenders = removeSpy.mock.calls.filter(
			([type]) => type === "keydown",
		).length;

		expect(addCountAfterRerenders).toBe(addCountAfterMount);
		expect(removeCountAfterRerenders).toBe(removeCountAfterMount);

		addSpy.mockRestore();
		removeSpy.mockRestore();
	});
});
