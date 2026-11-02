import { z } from "zod";

const FunctionSchema = z.custom<(...args: unknown[]) => unknown>(
	(value) => typeof value === "function",
	{ message: "must be a function" },
);

function normaliseEntry(value: unknown): unknown {
	if (typeof value === "function") return { handler: value };
	if (value === null || typeof value !== "object") return value;
	const proto: unknown = Object.getPrototypeOf(value);
	if (proto === Object.prototype || proto === null) return value;
	return null;
}

const FiniteNumberSchema = z.custom<number>((v) => typeof v === "number" && Number.isFinite(v), {
	message: "must be a finite number",
});

const NonNegativeFiniteNumberSchema = z.custom<number>(
	(v) => typeof v === "number" && Number.isFinite(v) && v >= 0,
	{ message: "must be a non-negative finite number" },
);

const HookEntryConfigSchema = z.looseObject({
	handler: FunctionSchema,
	priority: FiniteNumberSchema.optional(),
	timeout: NonNegativeFiniteNumberSchema.optional(),
	dependencies: z.array(z.string()).optional(),
	errorPolicy: z
		.enum(["continue", "abort"], {
			message: `must be "continue" or "abort"`,
		})
		.optional(),
	exclusive: z.boolean().optional(),
});

export const HookEntrySchema = z.preprocess(normaliseEntry, HookEntryConfigSchema);

const RouteEntryConfigSchema = z.looseObject({
	handler: FunctionSchema,
	public: z.boolean().optional(),
	input: z.unknown().optional(),
	permission: z.string().optional(),
});

export const RouteEntrySchema = z.preprocess(normaliseEntry, RouteEntryConfigSchema);

function coerceOptionalRecord(value: unknown): unknown {
	if (value === undefined) return undefined;
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return {};
	}
	return value;
}

export const ProbedDefaultSchema = z.looseObject({
	hooks: z.preprocess(coerceOptionalRecord, z.record(z.string(), HookEntrySchema)).optional(),
	routes: z.preprocess(coerceOptionalRecord, z.record(z.string(), RouteEntrySchema)).optional(),
	mcp: z
		.object({
			tools: z.record(
				z.string(),
				z.object({
					description: z.string().min(1),
					route: z.string().min(1),
					input: z.unknown(),
					output: z.unknown().optional(),
					destructive: z.boolean().optional(),
				}),
			),
		})
		.optional(),
});

export type ProbedDefault = z.infer<typeof ProbedDefaultSchema>;
export type ProbedHookEntry = z.infer<typeof HookEntrySchema>;
export type ProbedRouteEntry = z.infer<typeof RouteEntrySchema>;
