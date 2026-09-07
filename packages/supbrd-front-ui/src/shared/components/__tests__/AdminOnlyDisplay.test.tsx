import { beforeEach, describe, expect, it, vi } from "vitest";

import AdminOnlyDisplay from "../../../../../supbrd-runtime-plugins/src/front/client/plugins/supbrd-plug-settings/source/lib/adminOnlyDisplay.js";
import { render, screen } from "../../../../tests/render.js";

const mocks = vi.hoisted(() => ({
	useProjectSelection: vi.fn(),
}));

vi.mock("../../context/useProjectSelection.js", () => ({
	useProjectSelection: mocks.useProjectSelection,
}));

describe("AdminOnlyDisplay", () => {
	beforeEach(() => {
		mocks.useProjectSelection.mockReset();
	});

	it.each(["owner", "admin"])("renders project actions for %s", (role) => {
		mocks.useProjectSelection.mockReturnValue({
			selectedInstance: { id: "10", role },
		});

		render(
			<AdminOnlyDisplay>
				<span>Delete Project</span>
			</AdminOnlyDisplay>,
		);

		expect(screen.getByText("Delete Project")).toBeInTheDocument();
	});

	it.each(["member", undefined])("hides project actions for role %s", (role) => {
		mocks.useProjectSelection.mockReturnValue({
			selectedInstance: { id: "10", role },
		});

		render(
			<AdminOnlyDisplay>
				<span>Delete Project</span>
			</AdminOnlyDisplay>,
		);

		expect(screen.queryByText("Delete Project")).not.toBeInTheDocument();
	});
});
