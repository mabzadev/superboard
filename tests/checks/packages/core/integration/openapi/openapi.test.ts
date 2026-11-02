import SwaggerParser from "@apidevtools/swagger-parser";
import { describe, expect, it } from "vitest";

import { generateOpenApiDocument } from "../../../../../../packages/core/src/api/openapi/document.js";

describe("OpenAPI spec validation", () => {
	it("produces a valid OpenAPI 3.1 document", async () => {
		const doc = generateOpenApiDocument();

		const validated = await SwaggerParser.validate(structuredClone(doc));

		expect(validated.openapi).toBe("3.1.0");
		expect(validated.info.title).toBe("EmDash CMS API");
	});

	it("resolves all $ref pointers without errors", async () => {
		const doc = generateOpenApiDocument();

		const dereferenced = await SwaggerParser.dereference(structuredClone(doc));

		const seen = new WeakSet();
		const json = JSON.stringify(dereferenced, (_key, value) => {
			if (typeof value === "object" && value !== null) {
				if (seen.has(value)) return "[Circular]";
				seen.add(value);
			}
			return value;
		});
		expect(json).not.toContain('"$ref"');
	});

	it("has all content paths with responses", () => {
		const doc = generateOpenApiDocument();
		const paths = doc.paths ?? {};

		for (const [path, pathItem] of Object.entries(paths)) {
			for (const method of ["get", "post", "put", "delete", "patch"] as const) {
				const op = (pathItem as Record<string, unknown>)?.[method] as
					| { responses?: Record<string, unknown>; operationId?: string }
					| undefined;
				if (!op) continue;

				expect(op.responses, `${method.toUpperCase()} ${path} missing responses`).toBeDefined();

				expect(op.operationId, `${method.toUpperCase()} ${path} missing operationId`).toBeDefined();

				const statusCodes = Object.keys(op.responses ?? {});
				const has2xx = statusCodes.some((code) => code.startsWith("2"));
				expect(has2xx, `${method.toUpperCase()} ${path} has no 2xx response`).toBe(true);
			}
		}
	});

	it("wraps all success responses in the { success, data } envelope", () => {
		const doc = generateOpenApiDocument();
		const paths = doc.paths ?? {};

		for (const [path, pathItem] of Object.entries(paths)) {
			for (const method of ["get", "post", "put", "delete", "patch"] as const) {
				const op = (pathItem as Record<string, unknown>)?.[method] as
					| { responses?: Record<string, Record<string, unknown>> }
					| undefined;
				if (!op?.responses) continue;

				for (const [statusCode, response] of Object.entries(op.responses)) {
					if (!statusCode.startsWith("2")) continue;

					const content = (response as Record<string, unknown>)?.content as
						| Record<string, { schema?: Record<string, unknown> }>
						| undefined;
					if (!content?.["application/json"]) continue;

					const schema = content["application/json"].schema;
					expect(
						schema,
						`${method.toUpperCase()} ${path} ${statusCode} missing schema`,
					).toBeDefined();

					const props = (schema as Record<string, unknown>)?.properties as
						| Record<string, unknown>
						| undefined;
					if (props) {
						expect(
							props,
							`${method.toUpperCase()} ${path} ${statusCode} envelope missing "data" property`,
						).toHaveProperty("data");
						expect(
							props,
							`${method.toUpperCase()} ${path} ${statusCode} envelope missing "success" property`,
						).toHaveProperty("success");
					}
				}
			}
		}
	});

	it("includes auth error responses on authenticated endpoints", () => {
		const doc = generateOpenApiDocument();
		const paths = doc.paths ?? {};

		const publicPaths = new Set(["/_emdash/api/comments/{collection}/{contentId}"]);

		for (const [path, pathItem] of Object.entries(paths)) {
			if (publicPaths.has(path)) continue;

			for (const method of ["get", "post", "put", "delete", "patch"] as const) {
				const op = (pathItem as Record<string, unknown>)?.[method] as
					| { responses?: Record<string, unknown> }
					| undefined;
				if (!op?.responses) continue;

				const statusCodes = Object.keys(op.responses);
				expect(statusCodes, `${method.toUpperCase()} ${path} missing 401`).toContain("401");
				expect(statusCodes, `${method.toUpperCase()} ${path} missing 403`).toContain("403");
			}
		}
	});

	it("has no duplicate operation IDs across all paths", () => {
		const doc = generateOpenApiDocument();
		const operationIds: string[] = [];

		for (const pathItem of Object.values(doc.paths ?? {})) {
			for (const method of ["get", "post", "put", "delete", "patch"] as const) {
				const op = (pathItem as Record<string, unknown>)?.[method] as
					| { operationId?: string }
					| undefined;
				if (op?.operationId) {
					operationIds.push(op.operationId);
				}
			}
		}

		const seen = new Set<string>();
		for (const id of operationIds) {
			expect(seen.has(id), `duplicate operationId: ${id}`).toBe(false);
			seen.add(id);
		}
	});

	it("registers referenced schemas as reusable components", async () => {
		const doc = generateOpenApiDocument();
		const schemas = doc.components?.schemas ?? {};
		const schemaNames = Object.keys(schemas);

		expect(schemaNames.length).toBeGreaterThanOrEqual(5);

		for (const [name, schema] of Object.entries(schemas)) {
			expect(schema, `component schema "${name}" is not an object`).toBeTypeOf("object");
		}
	});

	it("uses consistent error response shape across all error codes", () => {
		const doc = generateOpenApiDocument();
		const paths = doc.paths ?? {};

		for (const [path, pathItem] of Object.entries(paths)) {
			for (const method of ["get", "post", "put", "delete", "patch"] as const) {
				const op = (pathItem as Record<string, unknown>)?.[method] as
					| { responses?: Record<string, Record<string, unknown>> }
					| undefined;
				if (!op?.responses) continue;

				for (const [statusCode, response] of Object.entries(op.responses)) {
					const code = Number(statusCode);
					if (code < 400) continue;

					const content = (response as Record<string, unknown>)?.content as
						| Record<string, { schema?: Record<string, unknown> }>
						| undefined;
					if (!content?.["application/json"]) continue;

					const schema = content["application/json"].schema;
					expect(
						schema,
						`${method.toUpperCase()} ${path} ${statusCode} error missing schema`,
					).toBeDefined();

					const props = (schema as Record<string, unknown>)?.properties as
						| Record<string, unknown>
						| undefined;
					const ref = (schema as Record<string, unknown>)?.$ref as string | undefined;
					const usesApiError = typeof ref === "string" && ref.endsWith("/ApiError");
					if (props) {
						expect(
							props,
							`${method.toUpperCase()} ${path} ${statusCode} error envelope missing "success"`,
						).toHaveProperty("success");
					} else {
						expect(
							usesApiError,
							`${method.toUpperCase()} ${path} ${statusCode} error is neither a $ref to ApiError nor inline`,
						).toBe(true);
					}
				}
			}
		}
	});

	it("declares the success discriminant on the ApiError component", () => {
		const doc = generateOpenApiDocument();
		const apiError = (doc.components?.schemas ?? {})["ApiError"] as
			| { properties?: Record<string, unknown> }
			| undefined;
		expect(apiError, "ApiError component missing").toBeDefined();
		expect(apiError?.properties).toHaveProperty("success");
		expect(apiError?.properties).toHaveProperty("error");
	});
});
