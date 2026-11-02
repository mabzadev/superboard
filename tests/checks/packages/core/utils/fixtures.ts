import type { CreateContentInput } from "../../../../../packages/core/src/database/repositories/types.js";

export function createPostFixture(overrides: Partial<CreateContentInput> = {}): CreateContentInput {
	return {
		type: "post",
		slug: "hello-world",
		data: {
			title: "Hello World",
			content: [
				{
					_type: "block",
					style: "normal",
					children: [
						{
							_type: "span",
							text: "This is a test post",
						},
					],
				},
			],
		},
		status: "draft",
		...overrides,
	};
}

export function createPageFixture(overrides: Partial<CreateContentInput> = {}): CreateContentInput {
	return {
		type: "page",
		slug: "about",
		data: {
			title: "About",
			content: [
				{
					_type: "block",
					style: "normal",
					children: [
						{
							_type: "span",
							text: "About page content",
						},
					],
				},
			],
		},
		status: "draft",
		...overrides,
	};
}
