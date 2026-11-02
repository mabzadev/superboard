const IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]*$/;

const GENERIC_IDENTIFIER_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]*$/;

const PLUGIN_IDENTIFIER_PATTERN = /^[a-z][a-z0-9_-]*$/;

const STORAGE_COLLECTION_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

const MAX_IDENTIFIER_LENGTH = 128;

export class IdentifierError extends Error {
	constructor(
		message: string,
		public identifier: string,
	) {
		super(message);
		this.name = "IdentifierError";
	}
}

export function validateIdentifier(value: string, label = "identifier"): void {
	if (!value || typeof value !== "string") {
		throw new IdentifierError(`${label} must be a non-empty string`, String(value));
	}

	if (value.length > MAX_IDENTIFIER_LENGTH) {
		throw new IdentifierError(
			`${label} must be ${MAX_IDENTIFIER_LENGTH} characters or less, got ${value.length}`,
			value,
		);
	}

	if (!IDENTIFIER_PATTERN.test(value)) {
		throw new IdentifierError(`${label} must match /^[a-z][a-z0-9_]*$/ (got "${value}")`, value);
	}
}

export function validateJsonFieldName(value: string, label = "JSON field name"): void {
	if (!value || typeof value !== "string") {
		throw new IdentifierError(`${label} must be a non-empty string`, String(value));
	}

	if (value.length > MAX_IDENTIFIER_LENGTH) {
		throw new IdentifierError(
			`${label} must be ${MAX_IDENTIFIER_LENGTH} characters or less, got ${value.length}`,
			value,
		);
	}

	if (!GENERIC_IDENTIFIER_PATTERN.test(value)) {
		throw new IdentifierError(
			`${label} must match /^[a-zA-Z][a-zA-Z0-9_]*$/ (got "${value}")`,
			value,
		);
	}
}

export function validatePluginIdentifier(value: string, label = "plugin identifier"): void {
	if (!value || typeof value !== "string") {
		throw new IdentifierError(`${label} must be a non-empty string`, String(value));
	}

	if (value.length > MAX_IDENTIFIER_LENGTH) {
		throw new IdentifierError(
			`${label} must be ${MAX_IDENTIFIER_LENGTH} characters or less, got ${value.length}`,
			value,
		);
	}

	if (!PLUGIN_IDENTIFIER_PATTERN.test(value)) {
		throw new IdentifierError(`${label} must match /^[a-z][a-z0-9_-]*$/ (got "${value}")`, value);
	}
}

export function validateStorageCollectionName(value: string, label = "collection name"): void {
	if (!value || typeof value !== "string") {
		throw new IdentifierError(`${label} must be a non-empty string`, String(value));
	}

	if (value.length > MAX_IDENTIFIER_LENGTH) {
		throw new IdentifierError(
			`${label} must be ${MAX_IDENTIFIER_LENGTH} characters or less, got ${value.length}`,
			value,
		);
	}

	if (!STORAGE_COLLECTION_PATTERN.test(value)) {
		throw new IdentifierError(
			`${label} must match /^[a-zA-Z][a-zA-Z0-9_-]*$/ (got "${value}")`,
			value,
		);
	}
}
