import { useState } from "react";
import { expect, test, vi } from "vitest";

import {
	AutosaveIndicator,
	SettingsTextField,
	useSettingsAutosave,
} from "../../../../../packages/supbrd-front-ui/src/settings-form.js";
import { fireEvent, render, screen } from "../render.js";

function Editor({ save, initial = "" }: { save(value: string): Promise<void>; initial?: string }) {
	const [value, setValue] = useState(initial);
	const { status, retry } = useSettingsAutosave({
		resourceKey: "settings",
		value,
		save,
		delay: 20,
	});
	return (
		<>
			<input
				aria-label="Name"
				value={value}
				onChange={(event) => {
					setValue(event.target.value);
				}}
			/>
			<AutosaveIndicator status={status} onRetry={retry} />
		</>
	);
}

function type(value: string) {
	fireEvent.change(screen.getByLabelText("Name"), { target: { value } });
}

test("a change is saved once, with its latest value, after the operator pauses", async () => {
	const save = vi.fn(async () => undefined);
	render(<Editor save={save} />);
	type("A");
	type("Ac");
	type("Acme");
	expect(save).not.toHaveBeenCalled();
	await vi.waitFor(() => expect(save).toHaveBeenCalledWith("Acme"));
	expect(save).toHaveBeenCalledTimes(1);
	expect(await screen.findByText("All changes saved.")).toBeInTheDocument();
});

test("an edit made while a save is running is saved right after it", async () => {
	const first = Promise.withResolvers<undefined>();
	const save = vi.fn(async (value: string) => (value === "Acme" ? first.promise : undefined));
	render(<Editor save={save} />);
	type("Acme");
	await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
	type("Acme Inc");
	first.resolve(undefined);
	await vi.waitFor(() => expect(save).toHaveBeenLastCalledWith("Acme Inc"));
	expect(save).toHaveBeenCalledTimes(2);
});

test("a failed save stops retrying until the operator asks again", async () => {
	const save = vi
		.fn<(value: string) => Promise<void>>()
		.mockRejectedValueOnce(new Error("offline"))
		.mockResolvedValue(undefined);
	render(<Editor save={save} />);
	type("Acme");
	expect(await screen.findByRole("alert")).toHaveTextContent("Changes could not be saved.");
	await new Promise((resolve) => {
		setTimeout(resolve, 80);
	});
	expect(save).toHaveBeenCalledTimes(1);
	fireEvent.click(screen.getByRole("button", { name: "Try again" }));
	await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
	expect(await screen.findByText("All changes saved.")).toBeInTheDocument();
});

test("values loaded for another resource are not saved back", async () => {
	const save = vi.fn(async () => undefined);
	function Switcher() {
		const [resource, setResource] = useState({ key: "project-a", value: "A" });
		const { status } = useSettingsAutosave({
			resourceKey: resource.key,
			value: resource.value,
			save,
			delay: 20,
		});
		return (
			<button
				type="button"
				data-status={status}
				onClick={() => {
					setResource({ key: "project-b", value: "B" });
				}}
			>
				Switch
			</button>
		);
	}
	render(<Switcher />);
	fireEvent.click(screen.getByRole("button", { name: "Switch" }));
	await new Promise((resolve) => {
		setTimeout(resolve, 80);
	});
	expect(save).not.toHaveBeenCalled();
});

test("reverting to the saved value before the delay leaves nothing pending", async () => {
	const save = vi.fn(async () => undefined);
	render(<Editor save={save} initial="Acme" />);
	type("Acme Inc");
	type("Acme");
	await new Promise((resolve) => {
		setTimeout(resolve, 80);
	});
	expect(save).not.toHaveBeenCalled();
	expect(screen.queryByText("Saving…")).toBeNull();
});

test("a text field is named by its visible label without accessibility warnings", () => {
	const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
	try {
		render(<SettingsTextField label="Sender name" value="" onChange={() => undefined} />);
		expect(screen.getByRole("textbox", { name: "Sender name" })).toBeInTheDocument();
		expect(warn).not.toHaveBeenCalledWith(expect.stringContaining("accessible name"));
	} finally {
		warn.mockRestore();
	}
});
