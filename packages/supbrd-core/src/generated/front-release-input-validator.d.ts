/* Generated from schemas/front-release-input.schema.json. Do not edit. */
import type { ErrorObject } from "ajv";
import type { FrontReleaseInput } from "../contracts.js";

declare const validate: {
	(data: unknown): data is FrontReleaseInput;
	errors?: ErrorObject[] | null;
};

export default validate;
