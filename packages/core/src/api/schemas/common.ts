import { z } from "zod";

import { LOCALE_CODE_PATTERN } from "../../i18n/config.js";

export const VALID_ROLE_LEVELS = new Set([10, 20, 30, 40, 50]);

export const roleLevel = z.coerce
	.number()
	.int()
	.refine((n): n is 10 | 20 | 30 | 40 | 50 => VALID_ROLE_LEVELS.has(n), {
		message: "Invalid role level. Must be 10, 20, 30, 40, or 50",
	});

export const cursorPaginationQuery = z
	.object({
		cursor: z.string().max(2048).optional().meta({ description: "Opaque cursor for pagination" }),
		limit: z.coerce.number().int().min(1).max(100).optional().default(50).meta({
			description: "Maximum number of items to return (1-100, default 50)",
		}),
	})
	.meta({ id: "CursorPaginationQuery" });

export const offsetPaginationQuery = z
	.object({
		limit: z.coerce.number().int().min(1).max(100).optional().default(50),
		offset: z.coerce.number().int().min(0).optional().default(0),
	})
	.meta({ id: "OffsetPaginationQuery" });

export const slugPattern = /^[a-z][a-z0-9_]*$/;

const HTTP_SCHEME_RE = /^https?:\/\//i;

export const httpUrl = z
	.string()
	.url()
	.refine((url) => HTTP_SCHEME_RE.test(url), "URL must use http or https");

export const localeCode = z.string().regex(LOCALE_CODE_PATTERN, "Invalid locale code");

export const localeFilterQuery = z
	.object({
		locale: localeCode.optional(),
	})
	.meta({ id: "LocaleFilterQuery" });

export const apiErrorSchema = z
	.object({
		success: z.literal(false).meta({ description: "Discriminant: always false for errors" }),
		error: z.object({
			code: z.string().meta({ description: "Machine-readable error code", example: "NOT_FOUND" }),
			message: z.string().meta({ description: "Human-readable error message" }),
		}),
	})
	.meta({ id: "ApiError" });

export function successEnvelope<T extends z.ZodType>(dataSchema: T) {
	return z.object({
		success: z.literal(true).meta({ description: "Discriminant: always true for success" }),
		data: dataSchema,
	});
}

export const deleteResponseSchema = z.object({ deleted: z.literal(true) }).meta({
	id: "DeleteResponse",
});

export const countResponseSchema = z
	.object({ count: z.number().int().min(0) })
	.meta({ id: "CountResponse" });
