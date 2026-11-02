import type { SandboxedPlugin } from "emdash/plugin";

export default {
	hooks: {
		"content:beforeSave": {
			handler: async (event, ctx) => {
				ctx.log.info("[marketplace-test] beforeSave fired", {
					collection: event.collection,
					isNew: event.isNew,
				});

				await ctx.storage.events.put(`hook-${Date.now()}`, {
					timestamp: new Date().toISOString(),
					type: "content:beforeSave",
					collection: event.collection,
					isNew: event.isNew,
				});

				return event.content;
			},
		},
	},

	routes: {
		ping: {
			handler: async (_routeCtx, ctx) => ({
				pong: true,
				pluginId: ctx.plugin.id,
				timestamp: Date.now(),
			}),
		},

		events: {
			handler: async (_routeCtx, ctx) => {
				const result = await ctx.storage.events.query({ limit: 10 });
				return { count: result.items.length, items: result.items };
			},
		},
	},
} satisfies SandboxedPlugin;
