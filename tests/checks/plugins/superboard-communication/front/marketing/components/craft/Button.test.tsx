import { Editor, Element, Frame } from "@craftjs/core";
import { describe, expect, it, vi } from "vitest";

import { ButtonComponent } from "../../../../../../../../packages/plugins/superboard-communication/src/front/marketing/components/craft/Button.js";
import { fireEvent, render, screen } from "../../../../../../packages/supbrd-front-ui/render.js";

describe("in-app editor button", () => {
	it("selecting a button in the editor does not submit the surrounding message form", () => {
		const submit = vi.fn();
		render(
			<form
				onSubmit={(event) => {
					event.preventDefault();
					submit();
				}}
			>
				<Editor resolver={{ ButtonComponent }}>
					<Frame>
						<Element is={ButtonComponent} text="Buy now" />
					</Frame>
				</Editor>
			</form>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Buy now" }));
		expect(submit).not.toHaveBeenCalled();
	});
});
