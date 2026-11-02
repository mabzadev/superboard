import { genRandomString, genCodeChallenge } from "@melody-auth/shared";
import { describe, it, expect, vi, beforeEach, afterEach, Mock } from "vitest";

import {
	genCodeVerifierAndChallenge,
	genAuthorizeState,
} from "../../../../../../../sdks/web/identity/web/src/generators";

vi.mock("@melody-auth/shared", () => ({
	genRandomString: vi.fn(),
	genCodeChallenge: vi.fn(),
}));

describe("generators", () => {
	describe("genCodeVerifierAndChallenge", () => {
		it("should generate code verifier and challenge", async () => {
			const mockVerifier = "test_verifier";
			const mockChallenge = "test_challenge";
			vi.mocked(genRandomString).mockReturnValue(mockVerifier);
			vi.mocked(genCodeChallenge).mockResolvedValue(mockChallenge);

			const result = await genCodeVerifierAndChallenge();

			expect(genRandomString).toHaveBeenCalledWith(128);
			expect(genCodeChallenge).toHaveBeenCalledWith(mockVerifier);
			expect(result).toEqual({
				codeVerifier: mockVerifier,
				codeChallenge: mockChallenge,
			});
		});
	});

	describe("genAuthorizeState", () => {
		let mockCrypto: { getRandomValues: Mock };
		let originalDescriptor: PropertyDescriptor | undefined;

		beforeEach(() => {
			mockCrypto = {
				getRandomValues: vi.fn((array: Uint8Array) => {
					for (let i = 0; i < array.length; i++) {
						array[i] = i;
					}
					return array;
				}),
			};

			originalDescriptor = Object.getOwnPropertyDescriptor(global, "crypto");

			Object.defineProperty(global, "crypto", {
				value: mockCrypto,
				writable: true,
				configurable: true,
			});
		});

		afterEach(() => {
			if (originalDescriptor) {
				Object.defineProperty(global, "crypto", originalDescriptor);
			} else {
				delete (global as any).crypto;
			}
		});

		it("should generate a hex string of specified length", () => {
			const result = genAuthorizeState(4);

			expect(result).toBe("00010203");
			expect(mockCrypto.getRandomValues).toHaveBeenCalled();
		});

		it("should generate strings of different lengths", () => {
			const length = 8;
			const result = genAuthorizeState(length);

			expect(result).toMatch(/^[0-9a-f]{16}$/);
			expect(result.length).toBe(length * 2);
		});
	});
});
