import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// Track router.replace calls and provide controllable searchParams
let mockSearchParams = new URLSearchParams();
const mockReplace = vi.fn();

vi.mock("next/navigation", () => ({
  useSearchParams: () => mockSearchParams,
  useRouter: () => ({ replace: mockReplace }),
  usePathname: () => "/test-path",
}));

import { useTableParams } from "../useTableParams";

describe("useTableParams", () => {
  beforeEach(() => {
    mockSearchParams = new URLSearchParams();
    mockReplace.mockClear();
  });

  describe("defaults", () => {
    it("returns correct default values when no URL params are set", () => {
      const { result } = renderHook(() => useTableParams());

      expect(result.current.page).toBe(1);
      expect(result.current.rowsPerPage).toBe(25);
      expect(result.current.sort).toEqual({
        sortKey: "updated_at",
        ascending: false,
      });
      expect(result.current.searchTerm).toBe("");
      expect(result.current.platform).toBe("");
      expect(result.current.totalPages).toBe(0);
      expect(result.current.totalRows).toBe(0);
    });

    it("uses custom defaults from options", () => {
      const { result } = renderHook(() =>
        useTableParams({
          defaultSortKey: "created_at",
          defaultPageSize: 50,
        })
      );

      expect(result.current.rowsPerPage).toBe(50);
      expect(result.current.sort).toEqual({
        sortKey: "created_at",
        ascending: false,
      });
    });

    it("returns date range defaulting to last 30 days", () => {
      const { result } = renderHook(() => useTableParams());

      expect(result.current.dateRange).toBeDefined();
      expect(result.current.dateRange?.from).toBeInstanceOf(Date);
      expect(result.current.dateRange?.to).toBeInstanceOf(Date);
    });

    it("uses custom defaultDateRange from options", () => {
      const from = new Date("2024-01-01");
      const to = new Date("2024-01-31");
      const { result } = renderHook(() =>
        useTableParams({ defaultDateRange: { from, to } })
      );

      expect(result.current.dateRange?.from).toEqual(from);
      expect(result.current.dateRange?.to).toEqual(to);
    });
  });

  describe("page from URL", () => {
    it("reads page from search params", () => {
      mockSearchParams = new URLSearchParams("page=3");
      const { result } = renderHook(() => useTableParams());

      expect(result.current.page).toBe(3);
    });

    it("clamps page to minimum of 1", () => {
      mockSearchParams = new URLSearchParams("page=0");
      const { result } = renderHook(() => useTableParams());

      expect(result.current.page).toBe(1);
    });

    it("falls back to 1 for invalid page values", () => {
      mockSearchParams = new URLSearchParams("page=abc");
      const { result } = renderHook(() => useTableParams());

      expect(result.current.page).toBe(1);
    });
  });

  describe("setPage", () => {
    it("updates URL with page number", () => {
      const { result } = renderHook(() => useTableParams());

      act(() => {
        result.current.setPage(5);
      });

      expect(mockReplace).toHaveBeenCalledWith("/test-path?page=5", {
        scroll: false,
      });
    });

    it("removes page param when setting to page 1", () => {
      const { result } = renderHook(() => useTableParams());

      act(() => {
        result.current.setPage(1);
      });

      expect(mockReplace).toHaveBeenCalledWith("/test-path", { scroll: false });
    });
  });

  describe("rowsPerPage from URL", () => {
    it("reads perPage from search params", () => {
      mockSearchParams = new URLSearchParams("perPage=50");
      const { result } = renderHook(() => useTableParams());

      expect(result.current.rowsPerPage).toBe(50);
    });
  });

  describe("setRowsPerPage", () => {
    it("updates URL and resets page", () => {
      mockSearchParams = new URLSearchParams("page=3");
      const { result } = renderHook(() => useTableParams());

      act(() => {
        result.current.setRowsPerPage(50);
      });

      expect(mockReplace).toHaveBeenCalledWith(
        expect.stringContaining("perPage=50"),
        { scroll: false }
      );
      // page should be removed (reset)
      expect(mockReplace).toHaveBeenCalledWith(
        expect.not.stringContaining("page="),
        { scroll: false }
      );
    });

    it("removes perPage param when setting to default page size", () => {
      const { result } = renderHook(() => useTableParams());

      act(() => {
        result.current.setRowsPerPage(25); // default
      });

      expect(mockReplace).toHaveBeenCalledWith("/test-path", { scroll: false });
    });
  });

  describe("sort from URL", () => {
    it("reads sort from search params", () => {
      mockSearchParams = new URLSearchParams("sort=name:asc");
      const { result } = renderHook(() => useTableParams());

      expect(result.current.sort).toEqual({ sortKey: "name", ascending: true });
    });

    it("reads descending sort", () => {
      mockSearchParams = new URLSearchParams("sort=name:desc");
      const { result } = renderHook(() => useTableParams());

      expect(result.current.sort).toEqual({
        sortKey: "name",
        ascending: false,
      });
    });
  });

  describe("setSort", () => {
    it("updates URL with sort value and resets page", () => {
      const { result } = renderHook(() => useTableParams());

      act(() => {
        result.current.setSort({ sortKey: "name", ascending: true });
      });

      expect(mockReplace).toHaveBeenCalledWith("/test-path?sort=name%3Aasc", {
        scroll: false,
      });
    });

    it("removes sort param when setting to default sort", () => {
      const { result } = renderHook(() => useTableParams());

      act(() => {
        result.current.setSort({ sortKey: "updated_at", ascending: false });
      });

      expect(mockReplace).toHaveBeenCalledWith("/test-path", { scroll: false });
    });

    it("supports functional updates", () => {
      const { result } = renderHook(() => useTableParams());

      act(() => {
        result.current.setSort((prev) => ({ ...prev, ascending: true }));
      });

      expect(mockReplace).toHaveBeenCalledWith(
        "/test-path?sort=updated_at%3Aasc",
        { scroll: false }
      );
    });
  });

  describe("searchTerm", () => {
    it("reads search term from URL on mount", () => {
      mockSearchParams = new URLSearchParams("q=hello");
      const { result } = renderHook(() => useTableParams());

      expect(result.current.searchTerm).toBe("hello");
    });

    it("updates local state immediately on setSearchTerm", () => {
      const { result } = renderHook(() => useTableParams());

      act(() => {
        result.current.setSearchTerm("test");
      });

      expect(result.current.searchTerm).toBe("test");
    });
  });

  describe("dateRange from URL", () => {
    it("reads date range from search params", () => {
      const from = "2024-06-01T00:00:00.000Z";
      const to = "2024-06-30T00:00:00.000Z";
      mockSearchParams = new URLSearchParams(`from=${from}&to=${to}`);
      const { result } = renderHook(() => useTableParams());

      expect(result.current.dateRange?.from?.toISOString()).toBe(from);
      expect(result.current.dateRange?.to?.toISOString()).toBe(to);
    });
  });

  describe("setDateRange", () => {
    it("updates URL with date range", () => {
      const { result } = renderHook(() => useTableParams());

      const from = new Date("2024-01-01T00:00:00.000Z");
      const to = new Date("2024-01-31T00:00:00.000Z");
      act(() => {
        result.current.setDateRange({ from, to });
      });

      expect(mockReplace).toHaveBeenCalledWith(
        expect.stringContaining("from="),
        { scroll: false }
      );
      expect(mockReplace).toHaveBeenCalledWith(expect.stringContaining("to="), {
        scroll: false,
      });
    });

    it("clears date params when range is undefined", () => {
      mockSearchParams = new URLSearchParams("from=2024-01-01&to=2024-01-31");
      const { result } = renderHook(() => useTableParams());

      act(() => {
        result.current.setDateRange(undefined);
      });

      expect(mockReplace).toHaveBeenCalledWith("/test-path", { scroll: false });
    });

    it("clears date params when from is missing", () => {
      const { result } = renderHook(() => useTableParams());

      act(() => {
        result.current.setDateRange({ from: undefined, to: new Date() });
      });

      expect(mockReplace).toHaveBeenCalledWith("/test-path", { scroll: false });
    });
  });

  describe("platform", () => {
    it("reads platform from URL", () => {
      mockSearchParams = new URLSearchParams("platform=ios");
      const { result } = renderHook(() => useTableParams());

      expect(result.current.platform).toBe("ios");
    });

    it("defaults to empty string", () => {
      const { result } = renderHook(() => useTableParams());
      expect(result.current.platform).toBe("");
    });
  });

  describe("setPlatform", () => {
    it("updates URL with platform and resets page", () => {
      const { result } = renderHook(() => useTableParams());

      act(() => {
        result.current.setPlatform("android");
      });

      expect(mockReplace).toHaveBeenCalledWith("/test-path?platform=android", {
        scroll: false,
      });
    });

    it("removes platform param when setting empty string", () => {
      mockSearchParams = new URLSearchParams("platform=ios");
      const { result } = renderHook(() => useTableParams());

      act(() => {
        result.current.setPlatform("");
      });

      expect(mockReplace).toHaveBeenCalledWith("/test-path", { scroll: false });
    });
  });

  describe("totalPages and totalRows", () => {
    it("can update totalPages", () => {
      const { result } = renderHook(() => useTableParams());

      act(() => {
        result.current.setTotalPages(10);
      });

      expect(result.current.totalPages).toBe(10);
    });

    it("can update totalRows", () => {
      const { result } = renderHook(() => useTableParams());

      act(() => {
        result.current.setTotalRows(250);
      });

      expect(result.current.totalRows).toBe(250);
    });
  });
});
