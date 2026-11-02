import { describe, it, expect } from "vitest";

import {
	calculateReadingTime,
	countWords,
} from "../../../../../packages/admin/src/components/PortableTextEditor";

const words = (n: number) => "word ".repeat(n).trim();

describe("Editor Metrics", () => {
	describe("calculateReadingTime", () => {
		it("returns 0 minutes for empty document", () => {
			expect(calculateReadingTime("")).toBe(0);
		});

		it("returns 1 minute for less than 200 words", () => {
			expect(calculateReadingTime(words(1))).toBe(1);
			expect(calculateReadingTime(words(100))).toBe(1);
			expect(calculateReadingTime(words(199))).toBe(1);
		});

		it("returns 1 minute for exactly 200 words", () => {
			expect(calculateReadingTime(words(200))).toBe(1);
		});

		it("returns 2 minutes for 201-400 words", () => {
			expect(calculateReadingTime(words(201))).toBe(2);
			expect(calculateReadingTime(words(300))).toBe(2);
			expect(calculateReadingTime(words(400))).toBe(2);
		});

		it("returns correct reading time for larger documents", () => {
			expect(calculateReadingTime(words(1000))).toBe(5);
			expect(calculateReadingTime(words(1001))).toBe(6);
			expect(calculateReadingTime(words(2000))).toBe(10);
		});

		it("always rounds up (ceil)", () => {
			expect(calculateReadingTime(words(201))).toBe(2);
			expect(calculateReadingTime(words(401))).toBe(3);
		});

		it("counts CJK content by character, matching the published reading time", () => {
			expect(calculateReadingTime("日".repeat(2000))).toBe(4);
			expect(calculateReadingTime("中".repeat(1000))).toBe(2);
			expect(calculateReadingTime("한".repeat(2000))).toBe(4);
		});

		it("adds word-based and CJK reading time for mixed content", () => {
			expect(calculateReadingTime(`${words(200)} ${"日".repeat(500)}`)).toBe(2);
		});
	});

	describe("countWords", () => {
		it("counts space-separated words for word-based scripts", () => {
			expect(countWords("")).toBe(0);
			expect(countWords("hello world")).toBe(2);
		});

		it("counts CJK characters individually", () => {
			expect(countWords("日本語")).toBe(3);
			expect(countWords("中文测试")).toBe(4);
		});

		it("combines word-based and CJK counts", () => {
			expect(countWords("hello 日本")).toBe(3);
		});
	});
});
