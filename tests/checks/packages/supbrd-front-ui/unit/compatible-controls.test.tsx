import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import {
	Button,
	Input,
	InputArea,
	LinkButton,
	Select,
} from "../../../../../packages/supbrd-front-ui/src/kumo.js";

describe("Front controls with the Kumo interface", () => {
	it("preserves labels, editing and validation descriptions", () => {
		function Form() {
			const [name, setName] = useState("");
			return (
				<>
					<Input
						label="Name"
						value={name}
						onChange={(event) => setName(event.target.value)}
						error={name ? undefined : "Required"}
					/>
					<InputArea label="Description" />
					<Select label="Language" value="fr" items={{ fr: "Français" }}>
						<Select.Option value="fr">Français</Select.Option>
					</Select>
				</>
			);
		}
		render(<Form />);
		const name = screen.getByRole("textbox", { name: "Name" });
		expect(name).toHaveAccessibleDescription("Required");
		fireEvent.change(name, { target: { value: "Message" } });
		expect(name).toHaveValue("Message");
		expect(screen.queryByText("Required")).not.toBeInTheDocument();
		expect(screen.getByRole("textbox", { name: "Description" })).toBeInTheDocument();
		expect(screen.getByRole("combobox", { name: "Language" })).toHaveTextContent("Français");
	});

	it("blocks the action while loading without losing the accessible label", () => {
		const onClick = vi.fn();
		render(
			<Button variant="primary" loading onClick={onClick}>
				Save
			</Button>,
		);
		const button = screen.getByRole("button", { name: "Save" });
		fireEvent.click(button);
		expect(onClick).not.toHaveBeenCalled();
		expect(button).toBeDisabled();
		expect(button).toHaveAttribute("aria-busy", "true");
	});

	it("keeps external navigation as an anchor", () => {
		render(
			<LinkButton href="https://example.com/docs" external>
				Documentation
			</LinkButton>,
		);
		const link = screen.getByRole("link", { name: "Documentation" });
		expect(link).toHaveAttribute("href", "https://example.com/docs");
		expect(link).toHaveAttribute("target", "_blank");
		expect(link).toHaveAttribute("rel", "noopener noreferrer");
	});
});
