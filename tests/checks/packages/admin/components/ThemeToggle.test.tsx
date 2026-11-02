import * as React from "react";
import { describe, it, expect, beforeEach } from "vitest";

import { ThemeProvider } from "../../../../../packages/admin/src/components/ThemeProvider";
import { ThemeToggle } from "../../../../../packages/admin/src/components/ThemeToggle";
import { render } from "../utils/render.tsx";

function TestThemeToggle({ defaultTheme = "system" as "system" | "light" | "dark" }) {
	return (
		<ThemeProvider defaultTheme={defaultTheme}>
			<ThemeToggle />
		</ThemeProvider>
	);
}

describe("ThemeToggle", () => {
	beforeEach(() => {
		localStorage.clear();
		document.documentElement.removeAttribute("data-theme");
	});

	it("renders with system theme by default", async () => {
		const screen = await render(<TestThemeToggle />);
		const button = screen.getByRole("button");
		await expect.element(button).toBeInTheDocument();
		await expect.element(button).toHaveAttribute("aria-label", expect.stringContaining("System"));
	});

	it("cycles from system to light on click", async () => {
		const screen = await render(<TestThemeToggle />);
		const button = screen.getByRole("button");
		await button.click();
		await expect.element(button).toHaveAttribute("aria-label", expect.stringContaining("Light"));
	});

	it("cycles through system -> light -> dark -> system", async () => {
		const screen = await render(<TestThemeToggle />);
		const button = screen.getByRole("button");

		await expect.element(button).toHaveAttribute("aria-label", expect.stringContaining("System"));

		await button.click();
		await expect.element(button).toHaveAttribute("aria-label", expect.stringContaining("Light"));

		await button.click();
		await expect.element(button).toHaveAttribute("aria-label", expect.stringContaining("Dark"));

		await button.click();
		await expect.element(button).toHaveAttribute("aria-label", expect.stringContaining("System"));
	});

	it("persists theme to localStorage", async () => {
		const screen = await render(<TestThemeToggle />);
		const button = screen.getByRole("button");
		await button.click();
		expect(localStorage.getItem("emdash-theme")).toBe("light");
	});

	it("starts with light theme when defaultTheme is light", async () => {
		const screen = await render(<TestThemeToggle defaultTheme="light" />);
		const button = screen.getByRole("button");
		await expect.element(button).toHaveAttribute("aria-label", expect.stringContaining("Light"));
	});
});
