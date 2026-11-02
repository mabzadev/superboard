import { describe, it, expect, vi, beforeEach } from "vitest";

import { renderHook, act, waitFor } from "../../../../../packages/supbrd-front-ui/render.js";

vi.mock(
	"../../../../../../../packages/plugins/superboard-core/src/front/settings/api/instances/instanceService.js",
	() => ({
		getSetupProgressAPICall: vi.fn(),
		completeSetupStepAPICall: vi.fn(),
	}),
);

import {
	getSetupProgressAPICall,
	completeSetupStepAPICall,
} from "../../../../../../../packages/plugins/superboard-core/src/front/settings/api/instances/instanceService.js";
import { useSetupProgress } from "../../../../../../../packages/plugins/superboard-core/src/front/settings/hooks/useSetupProgress.js";

const mockedGetSetupProgress = vi.mocked(getSetupProgressAPICall);
const mockedCompleteSetupStep = vi.mocked(completeSetupStepAPICall);

describe("useSetupProgress", () => {
	const identifiers = ["step_a", "step_b", "step_c"] as const;

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("starts with an empty walkedSteps set", () => {
		mockedGetSetupProgress.mockResolvedValue({ data: { steps: [] } } as never);

		const { result } = renderHook(() => useSetupProgress("inst-1", "ios", identifiers));

		expect(result.current.walkedSteps.size).toBe(0);
	});

	it("does not fetch when instanceId is undefined", () => {
		const { result } = renderHook(() => useSetupProgress(undefined, "ios", identifiers));

		expect(mockedGetSetupProgress).not.toHaveBeenCalled();
		expect(result.current.walkedSteps.size).toBe(0);
	});

	it("loads completed steps from backend on mount", async () => {
		mockedGetSetupProgress.mockResolvedValue({
			data: {
				steps: [
					{ step_identifier: "step_a", completed_at: "2024-01-01" },
					{ step_identifier: "step_c", completed_at: "2024-01-02" },
				],
			},
		} as never);

		const { result } = renderHook(() => useSetupProgress("inst-1", "ios", identifiers));

		await waitFor(() => {
			expect(result.current.walkedSteps.size).toBe(2);
		});

		expect(result.current.walkedSteps.has(0)).toBe(true);
		expect(result.current.walkedSteps.has(1)).toBe(false);
		expect(result.current.walkedSteps.has(2)).toBe(true);
	});

	it("passes instanceId and category to the API call", async () => {
		mockedGetSetupProgress.mockResolvedValue({ data: { steps: [] } } as never);

		renderHook(() => useSetupProgress("inst-1", "android", identifiers));

		await waitFor(() => {
			expect(mockedGetSetupProgress).toHaveBeenCalledWith("inst-1", "android");
		});
	});

	it("ignores steps from backend that are not in identifiers", async () => {
		mockedGetSetupProgress.mockResolvedValue({
			data: {
				steps: [
					{ step_identifier: "unknown_step", completed_at: "2024-01-01" },
					{ step_identifier: "step_b", completed_at: "2024-01-01" },
				],
			},
		} as never);

		const { result } = renderHook(() => useSetupProgress("inst-1", "ios", identifiers));

		await waitFor(() => {
			expect(result.current.walkedSteps.size).toBe(1);
		});

		expect(result.current.walkedSteps.has(1)).toBe(true);
	});

	it("handles API error silently", async () => {
		mockedGetSetupProgress.mockRejectedValue(new Error("Network error"));

		const { result } = renderHook(() => useSetupProgress("inst-1", "ios", identifiers));

		await waitFor(() => {
			expect(mockedGetSetupProgress).toHaveBeenCalled();
		});

		expect(result.current.walkedSteps.size).toBe(0);
	});

	describe("markStepComplete", () => {
		it("adds step index to walkedSteps and calls API", async () => {
			mockedGetSetupProgress.mockResolvedValue({
				data: { steps: [] },
			} as never);
			mockedCompleteSetupStep.mockResolvedValue({ data: {} } as never);

			const { result } = renderHook(() => useSetupProgress("inst-1", "ios", identifiers));

			await waitFor(() => {
				expect(mockedGetSetupProgress).toHaveBeenCalled();
			});

			act(() => {
				result.current.markStepComplete(1);
			});

			expect(result.current.walkedSteps.has(1)).toBe(true);
			expect(mockedCompleteSetupStep).toHaveBeenCalledWith("inst-1", "ios", "step_b");
		});

		it("ignores out-of-range step indices (negative)", async () => {
			mockedGetSetupProgress.mockResolvedValue({
				data: { steps: [] },
			} as never);

			const { result } = renderHook(() => useSetupProgress("inst-1", "ios", identifiers));

			await waitFor(() => {
				expect(mockedGetSetupProgress).toHaveBeenCalled();
			});

			act(() => {
				result.current.markStepComplete(-1);
			});

			expect(result.current.walkedSteps.size).toBe(0);
			expect(mockedCompleteSetupStep).not.toHaveBeenCalled();
		});

		it("ignores out-of-range step indices (too large)", async () => {
			mockedGetSetupProgress.mockResolvedValue({
				data: { steps: [] },
			} as never);

			const { result } = renderHook(() => useSetupProgress("inst-1", "ios", identifiers));

			await waitFor(() => {
				expect(mockedGetSetupProgress).toHaveBeenCalled();
			});

			act(() => {
				result.current.markStepComplete(10);
			});

			expect(result.current.walkedSteps.size).toBe(0);
			expect(mockedCompleteSetupStep).not.toHaveBeenCalled();
		});

		it("does not call API when instanceId is undefined", async () => {
			const { result } = renderHook(() => useSetupProgress(undefined, "ios", identifiers));

			act(() => {
				result.current.markStepComplete(0);
			});

			expect(result.current.walkedSteps.has(0)).toBe(true);
			expect(mockedCompleteSetupStep).not.toHaveBeenCalled();
		});

		it("handles API error silently on markStepComplete", async () => {
			mockedGetSetupProgress.mockResolvedValue({
				data: { steps: [] },
			} as never);
			mockedCompleteSetupStep.mockRejectedValue(new Error("Server error"));

			const { result } = renderHook(() => useSetupProgress("inst-1", "ios", identifiers));

			await waitFor(() => {
				expect(mockedGetSetupProgress).toHaveBeenCalled();
			});

			act(() => {
				result.current.markStepComplete(0);
			});

			expect(result.current.walkedSteps.has(0)).toBe(true);
		});
	});

	describe("instance switch", () => {
		it("resets walked steps and refetches when instanceId changes", async () => {
			mockedGetSetupProgress
				.mockResolvedValueOnce({
					data: {
						steps: [{ step_identifier: "step_a", completed_at: "2024-01-01" }],
					},
				} as never)
				.mockResolvedValueOnce({
					data: {
						steps: [{ step_identifier: "step_c", completed_at: "2024-01-02" }],
					},
				} as never);

			const { result, rerender } = renderHook(
				({ instanceId }: { instanceId: string }) =>
					useSetupProgress(instanceId, "ios", identifiers),
				{ initialProps: { instanceId: "inst-1" } },
			);

			await waitFor(() => {
				expect(result.current.walkedSteps.has(0)).toBe(true);
			});

			rerender({ instanceId: "inst-2" });

			await waitFor(() => {
				expect(result.current.walkedSteps.has(2)).toBe(true);
			});

			expect(result.current.walkedSteps.has(0)).toBe(false);
			expect(mockedGetSetupProgress).toHaveBeenCalledTimes(2);
		});
	});
});
