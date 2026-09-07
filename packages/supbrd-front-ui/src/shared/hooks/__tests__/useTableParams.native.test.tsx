import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { useTableParams } from "../useTableParams.js";

afterEach(() => {
	vi.useRealTimers();
	window.history.replaceState({}, "", "/");
});
it("keeps a later sort when a pending search debounce updates the URL", () => {
	vi.useFakeTimers();
	window.history.replaceState({}, "", "/app/referrals");
	const { result } = renderHook(() => useTableParams({ defaultSortKey: "date" }));
	act(() => result.current.setSearchTerm("spring"));
	act(() => result.current.setSort({ sortKey: "id", ascending: true }));
	act(() => vi.advanceTimersByTime(300));
	const query = new URLSearchParams(window.location.search);
	expect(query.get("q")).toBe("spring");
	expect(query.get("sort")).toBe("id:asc");
	expect(result.current.sort).toEqual({ sortKey: "id", ascending: true });
});
