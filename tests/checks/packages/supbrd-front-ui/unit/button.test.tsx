import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Button } from "../../../../../packages/supbrd-front-ui/src/shared/components/ui/button.js";

describe("Button composition", () => {
	it("keeps a single link with its label and both icons", () => {
		render(
			<Button asChild icon={<span>Before</span>} iconRight={<span>After</span>}>
				<a href="/products">Products</a>
			</Button>,
		);
		const link = screen.getByRole("link");
		expect(link).toHaveTextContent("BeforeProductsAfter");
		expect(link).toHaveAttribute("href", "/products");
		expect(screen.queryByRole("button")).not.toBeInTheDocument();
	});

	it.each(["disabled", "loading"] as const)("blocks link activation while %s", (state) => {
		const onClick = vi.fn();
		render(
			<Button asChild {...{ [state]: true }}>
				<a href="/products" onClick={onClick}>
					Products
				</a>
			</Button>,
		);
		const link = screen.getByRole("link");
		expect(fireEvent.click(link)).toBe(false);
		expect(onClick).not.toHaveBeenCalled();
		expect(link).toHaveAttribute("aria-disabled", "true");
		expect(link).toHaveAttribute("tabindex", "-1");
		expect(link.getAttribute("aria-busy")).toBe(state === "loading" ? "true" : null);
	});

	it("preserves activation and submit semantics for enabled buttons", () => {
		const onClick = vi.fn();
		render(
			<Button type="submit" onClick={onClick}>
				Save
			</Button>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		expect(onClick).toHaveBeenCalledOnce();
		expect(screen.getByRole("button")).toHaveAttribute("type", "submit");
	});
});
