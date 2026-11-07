import { expect, it, vi } from "vitest";

import ScopesEditor from "../../../../../../packages/plugins/superboard-authentification/src/front/identity/components/ScopesEditor.js";
import type { Scope } from "../../../../../../packages/plugins/superboard-authentification/src/front/identity/services/auth/api.js";
import { fireEvent, render, screen } from "../../../../packages/supbrd-front-ui/render.js";

const scopes = [
	{ id: 1, name: "read_user" },
	{ id: 2, name: "write_user" },
] as Scope[];

it("names each scope switch after its scope and toggles the clicked scope", () => {
	const onToggleScope = vi.fn();
	render(<ScopesEditor scopes={scopes} value={["read_user"]} onToggleScope={onToggleScope} />);

	expect(screen.getByRole("switch", { name: "read_user" })).toBeChecked();
	expect(screen.getByRole("switch", { name: "write_user" })).not.toBeChecked();

	fireEvent.click(screen.getByText("write_user"));
	expect(onToggleScope).toHaveBeenCalledWith("write_user");
});

it("keeps every scope switch read-only when the editor is disabled", () => {
	render(<ScopesEditor scopes={scopes} value={[]} onToggleScope={vi.fn()} disabled />);

	for (const name of ["read_user", "write_user"])
		expect(screen.getByRole("switch", { name })).toBeDisabled();
});
