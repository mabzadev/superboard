import { Hono } from "hono";
import { z } from "zod";

import { upsertInstall } from "../db/queries.js";

export const statsRoutes = new Hono<{ Bindings: Env }>();

const installSchema = z.object({
	siteHash: z.string().min(1).max(128),
	version: z.string().min(1).max(64),
});

statsRoutes.post("/plugins/:id/installs", async (c) => {
	const pluginId = c.req.param("id");

	let body: z.infer<typeof installSchema>;
	try {
		const raw = await c.req.json();
		body = installSchema.parse(raw);
	} catch (err) {
		if (err instanceof z.ZodError) {
			return c.json({ error: "Invalid request body", details: err.errors }, 400);
		}
		return c.json({ error: "Invalid JSON" }, 400);
	}

	try {
		await upsertInstall(c.env.DB, {
			pluginId,
			siteHash: body.siteHash,
			version: body.version,
		});

		return c.json({ ok: true });
	} catch (err) {
		console.error("Failed to record install:", err);
		return c.json({ ok: true });
	}
});
