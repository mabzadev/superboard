import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

let mockSearchParams = new URLSearchParams();
const mockReplace = vi.fn();

vi.mock("next/navigation", () => ({
  useSearchParams: () => mockSearchParams,
  useRouter: () => ({ replace: mockReplace }),
  usePathname: () => "/test-path",
}));

import { useUrlState } from "../useUrlState";

describe("useUrlState", () => {
  beforeEach(() => {
    mockSearchParams = new URLSearchParams();
    mockReplace.mockClear();
  });

  describe("string mode (no parse/serialize options)", () => {
    it("returns default value when key is not in URL", () => {
      const { result } = renderHook(() => useUrlState("tab", "overview"));

      expect(result.current[0]).toBe("overview");
    });

    it("returns URL value when key exists in URL", () => {
      mockSearchParams = new URLSearchParams("tab=settings");
      const { result } = renderHook(() => useUrlState("tab", "overview"));

      expect(result.current[0]).toBe("settings");
    });

    it("sets value in URL via router.replace", () => {
      const { result } = renderHook(() => useUrlState("tab", "overview"));

      act(() => {
        result.current[1]("settings");
      });

      expect(mockReplace).toHaveBeenCalledWith("/test-path?tab=settings", {
        scroll: false,
      });
    });

    it("removes param when setting value equal to default", () => {
      mockSearchParams = new URLSearchParams("tab=settings");
      const { result } = renderHook(() => useUrlState("tab", "overview"));

      act(() => {
        result.current[1]("overview");
      });

      expect(mockReplace).toHaveBeenCalledWith("/test-path", { scroll: false });
    });

    it("removes param when setting empty string", () => {
      mockSearchParams = new URLSearchParams("tab=settings");
      const { result } = renderHook(() => useUrlState("tab", "overview"));

      act(() => {
        result.current[1]("");
      });

      expect(mockReplace).toHaveBeenCalledWith("/test-path", { scroll: false });
    });

    it("preserves other existing URL params", () => {
      mockSearchParams = new URLSearchParams("page=2&tab=overview");
      const { result } = renderHook(() => useUrlState("tab", "overview"));

      act(() => {
        result.current[1]("settings");
      });

      expect(mockReplace).toHaveBeenCalledWith(
        expect.stringContaining("page=2"),
        { scroll: false }
      );
      expect(mockReplace).toHaveBeenCalledWith(
        expect.stringContaining("tab=settings"),
        { scroll: false }
      );
    });
  });

  describe("with parse option", () => {
    it("parses URL value using parse function", () => {
      mockSearchParams = new URLSearchParams("count=42");
      const { result } = renderHook(() =>
        useUrlState("count", 0, { parse: (v) => parseInt(v, 10) })
      );

      expect(result.current[0]).toBe(42);
    });

    it("returns default value when key is not in URL", () => {
      const { result } = renderHook(() =>
        useUrlState("count", 10, { parse: (v) => parseInt(v, 10) })
      );

      expect(result.current[0]).toBe(10);
    });
  });

  describe("with serialize option", () => {
    it("uses serialize function when setting value", () => {
      const { result } = renderHook(() =>
        useUrlState("count", 0, {
          parse: (v) => parseInt(v, 10),
          serialize: (v) => String(v),
        })
      );

      act(() => {
        result.current[1](42);
      });

      expect(mockReplace).toHaveBeenCalledWith("/test-path?count=42", {
        scroll: false,
      });
    });

    it("removes param when serialized value equals serialized default", () => {
      const { result } = renderHook(() =>
        useUrlState("count", 0, {
          parse: (v) => parseInt(v, 10),
          serialize: (v) => String(v),
        })
      );

      act(() => {
        result.current[1](0);
      });

      expect(mockReplace).toHaveBeenCalledWith("/test-path", { scroll: false });
    });
  });

  describe("with boolean state", () => {
    it("parses boolean from URL", () => {
      mockSearchParams = new URLSearchParams("active=true");
      const { result } = renderHook(() =>
        useUrlState("active", false, {
          parse: (v) => v === "true",
          serialize: (v) => String(v),
        })
      );

      expect(result.current[0]).toBe(true);
    });

    it("sets boolean value in URL", () => {
      const { result } = renderHook(() =>
        useUrlState("active", false, {
          parse: (v) => v === "true",
          serialize: (v) => String(v),
        })
      );

      act(() => {
        result.current[1](true);
      });

      expect(mockReplace).toHaveBeenCalledWith("/test-path?active=true", {
        scroll: false,
      });
    });
  });

  describe("multiple keys do not interfere", () => {
    it("handles two different URL state keys independently", () => {
      mockSearchParams = new URLSearchParams("tab=settings&view=grid");

      const { result: tabResult } = renderHook(() =>
        useUrlState("tab", "overview")
      );
      const { result: viewResult } = renderHook(() =>
        useUrlState("view", "list")
      );

      expect(tabResult.current[0]).toBe("settings");
      expect(viewResult.current[0]).toBe("grid");
    });
  });
});
