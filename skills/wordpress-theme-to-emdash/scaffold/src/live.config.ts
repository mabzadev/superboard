import { defineCollection } from "astro:content";
import { emdashLoader } from "emdash";

export const collections = {
	posts: defineCollection({
		loader: emdashLoader({ collection: "posts" }),
	}),
	pages: defineCollection({
		loader: emdashLoader({ collection: "pages" }),
	}),
};
