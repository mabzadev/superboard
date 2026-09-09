import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { useDraftAutosave } from "../use-draft-autosave.js";
afterEach(() => vi.useRealTimers());
it("shows an unsaved invalid edit and persists it only after it becomes valid", async () => {
	vi.useFakeTimers();
	const save = vi.fn(async () => ({ id: "version" }));
	const onSaved = vi.fn();
	const { result, rerender } = renderHook(
		({ value, enabled }) =>
			useDraftAutosave({ resourceKey: "project:document", value, enabled, save, onSaved }),
		{ initialProps: { value: "original", enabled: true } },
	);
	rerender({ value: "", enabled: false });
	expect(result.current).toBe("Unsaved changes");
	await act(async () => {
		await vi.advanceTimersByTimeAsync(6000);
	});
	expect(save).not.toHaveBeenCalled();
	rerender({ value: "valid edit", enabled: true });
	await act(async () => {
		await vi.advanceTimersByTimeAsync(5000);
	});
	expect(result.current).toBe("Saved");
	expect(save).toHaveBeenCalledWith("valid edit");
});
