import { UsageError } from "../errors.js";
import { table, truncate } from "../format.js";

export const vectorCommands = {
	"vectors collections": {
		summary: "List the vector collections",
		usage: "superboard vectors collections",
		async run(ctx) {
			const result = await ctx.api().request("GET", "/manage/vector-collections");
			ctx.print(result, ({ items, available }) =>
				[
					...(available === false ? ["Vectors are not available in this environment.", ""] : []),
					table(
						items,
						[
							["NAME", (collection) => collection.name],
							["ITEMS", (collection) => collection.item_count ?? ""],
							["READ", (collection) => collection.rules.read],
							["WRITE", (collection) => collection.rules.write],
						],
						"No collections yet.",
					),
				].join("\n"),
			);
		},
	},
	"vectors query": {
		summary: "Search a collection by similarity to a text",
		usage: "superboard vectors query <collection> <text> [--top-k 10]",
		positionals: ["collection", "text"],
		options: { "top-k": { type: "string", description: "Number of matches, 1 to 50" } },
		async run(ctx, values, [collection, text]) {
			const body = { text };
			if (values["top-k"] !== undefined) {
				const topK = Number(values["top-k"]);
				if (!Number.isSafeInteger(topK) || topK < 1)
					throw new UsageError("--top-k expects a positive integer.");
				body.top_k = topK;
			}
			const result = await ctx
				.api()
				.request("POST", `/vectors/${encodeURIComponent(collection)}/query`, { json: body });
			ctx.print(result, ({ items }) =>
				table(
					items,
					[
						["SCORE", (match) => match.score.toFixed(4)],
						["ID", (match) => match.id],
						["CONTENT", (match) => truncate(match.content ?? JSON.stringify(match.metadata))],
					],
					"No matches.",
				),
			);
		},
	},
};
